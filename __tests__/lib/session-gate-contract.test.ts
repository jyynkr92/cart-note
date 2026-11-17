/**
 * 쓰기 큐 재생과 세션 게이트의 계약.
 *
 * TanStack의 QueryClient.mount()는 onlineManager를 구독하고 오프라인→온라인마다 resumePausedMutations()를 부른다.
 * 앱의 순서(소유자 확인, 세션 복구)를 기다리지 않는다. 세션 없이 재생되면 supabase-js가 anon 키로 요청하고,
 * RLS 때문에 update/delete는 0행을 바꾸고 "성공"한다(쓰기가 조용히 사라진다).
 * 그래서 두 겹으로 막는다.
 *   1) onlineManager는 session-gate만 정한다(network && reachable && 소유자 확인된 세션). 다른 곳에서
 *      setOnline을 부르거나 NetInfo를 setEventListener로 바로 연결하면(TanStack 문서의 RN 예제) 게이트를 우회한다.
 *   2) 모든 큐 mutation의 mutationFn은 sessionGuarded로 감싸, 요청 직전에 게이트를 연 사용자의 세션이 없으면
 *      아무 요청도 보내지 않고 SessionUnavailableError를 던진다(재시도 정책이 pause로 보내 영속화된다).
 *      networkMode 'always'/'offlineFirst'는 onlineManager를 무시하므로 큐 mutation에 쓰지 않는다.
 * 새 mk 키의 기본값을 sessionGuarded 없이 등록하면 이 테스트가 실패한다.
 * 배경: docs/solutions/logic-errors/offline-queue-replay-gated-on-owner-verified-session.md
 */
import fs from 'fs';
import path from 'path';
import { createQueryClient } from '@/src/lib/query-client';
import { mk } from '@/src/lib/query-keys';
import {
  installSessionCheck,
  openSession,
  resetSessionGateForTests,
  SessionUnavailableError,
} from '@/src/lib/session-gate';
import { supabase } from '@/src/lib/supabase';
import { disposeClient } from '@/test-utils/dispose-client';

jest.mock('@/src/lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('@/src/lib/toast', () => ({ toast: { error: jest.fn() } }));

const ROOT = process.cwd();

/** onlineManager 상태를 바꾸는 호출은 여기서만 허용한다. */
const ALLOWED_WRITERS: Record<string, { setOnline?: string; setEventListener?: string }> = {
  'src/lib/session-gate.ts': {
    setOnline: '게이트가 network && reachable && 소유자 확인된 세션으로 정하는 유일한 곳.',
  },
  // setEventListener는 기본 window 리스너를 비우는 no-op 형태(() => () => {})만 허용한다(src/lib/query-client.ts).
  // NetInfo는 setNetworkOnline으로 게이트에 넣는다.
};

/** networkMode를 바꾸는 곳. 큐 mutation(mk 키)은 들어가면 안 된다. */
const ALLOWED_NETWORK_MODE: Record<string, string> = {
  'app/(app)/list/[id]/locations.tsx': '장소 검색(큐 밖, 영속화 안 됨). 쓰기가 아니다.',
};

function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(e.name) ? [rel.split(path.sep).join('/')] : [];
  });
}

const files = [...sourceFiles('src'), ...sourceFiles('app'), ...sourceFiles('lib'), 'index.ts'].filter(
  (f) => fs.existsSync(path.join(ROOT, f))
);
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const WRITERS = {
  setOnline: /onlineManager\s*\.\s*setOnline\s*\(/,
  // no-op 리스너(() => () => {})가 아닌 setEventListener
  setEventListener: /onlineManager\s*\.\s*setEventListener\s*\((?!\s*\(\)\s*=>\s*\(\)\s*=>\s*\{\s*\}\s*\))/,
} as const;

describe.each(Object.keys(WRITERS) as (keyof typeof WRITERS)[])('onlineManager.%s callers', (name) => {
  it('are only the session gate wiring (anything else resumes the queue without a verified session)', () => {
    const callers = files.filter((f) => WRITERS[name].test(read(f)));
    expect(callers.filter((f) => !ALLOWED_WRITERS[f]?.[name])).toEqual([]);
  });
});

it('networkMode is only set outside the write queue', () => {
  const setters = files.filter((f) => /networkMode\s*:/.test(read(f)));
  expect(setters.filter((f) => !ALLOWED_NETWORK_MODE[f])).toEqual([]);
});

it('the allowlists have no stale entries', () => {
  for (const [file, calls] of Object.entries(ALLOWED_WRITERS))
    for (const name of Object.keys(calls) as (keyof typeof WRITERS)[])
      expect([file, name, WRITERS[name].test(read(file))]).toEqual([file, name, true]);
  for (const file of Object.keys(ALLOWED_NETWORK_MODE))
    expect([file, /networkMode\s*:/.test(read(file))]).toEqual([file, true]);
});

const KEYS = (Object.keys(mk) as (keyof typeof mk)[]).filter((k) => k !== 'all');

describe.each(KEYS)('queue mutation %s', (key) => {
  let client: ReturnType<typeof createQueryClient>;
  beforeEach(() => {
    jest.clearAllMocks();
    resetSessionGateForTests();
    client = createQueryClient();
    openSession('u1');
  });
  afterEach(() => {
    disposeClient(client);
    resetSessionGateForTests();
  });

  it('follows onlineManager (networkMode online)', () => {
    const mode = client.getMutationDefaults(mk[key]).networkMode;
    expect(mode ?? 'online').toBe('online');
  });

  it.each([
    ['no session (offline refresh failed)', null],
    ["another user's session", 'u2'],
  ])('sends nothing and pauses with %s', async (_label, sessionUser) => {
    installSessionCheck(async () => sessionUser);
    const fn = client.getMutationDefaults(mk[key]).mutationFn as ((v: unknown) => Promise<unknown>) | undefined;
    expect(fn).toBeDefined();
    await expect(fn!(undefined)).rejects.toBeInstanceOf(SessionUnavailableError);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});
