/**
 * 로그인 여부 판단의 계약.
 *
 * supabase-js의 getSession()과 INITIAL_SESSION은 오프라인에서 access token이 만료돼 갱신이 (재시도 가능하게)
 * 실패하면 null을 준다. 그래도 저장된 세션(refresh token)은 남아 있다. 즉 이 null은 "로그아웃"이 아니다.
 * 로그인 여부는 저장된 세션(src/auth/stored-session.ts의 readStoredSession/hasStoredSession)이나
 * 실제 SIGNED_OUT 이벤트로 정한다. 백그라운드/헤드리스 코드는 네트워크 갱신에 기대지 않는다.
 *
 * 그래서 getSession()과 onAuthStateChange를 부르는 곳을 아래 목록으로 고정한다. 새 호출이 생기면 이 테스트가
 * 실패한다. 목록에 넣기 전에 그 호출이 null을 "로그아웃"으로 쓰지 않는지 확인하고, 이유를 함께 적는다.
 * 화면이나 가드가 useAuth()의 session null을 로그아웃으로 쓰는 실수(offlineUserId를 빠뜨리는 것)는
 * 이 테스트가 잡지 못한다. 아래 learning을 본다.
 * 배경: docs/solutions/logic-errors/supabase-null-session-offline-is-not-signed-out.md
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

const ALLOWED: Record<string, { getSession?: string; onAuthStateChange?: string }> = {
  'src/auth/session-check.ts': {
    getSession: '큐 요청 직전의 실제 토큰 확인. null이면 지금 보내지 않을 뿐(로그아웃 판단 아님).',
  },
  'src/auth/AuthProvider.tsx': {
    getSession: '딥링크: 이미 로그인돼 있으면 링크를 무시하는 데만 쓴다.',
    onAuthStateChange:
      '인증 이벤트를 앱 상태로 바꾸는 유일한 곳. SIGNED_OUT만 로그아웃으로 보고, 그 밖의 null은 저장된 세션을 읽는다.',
  },
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

const files = [...sourceFiles('src'), ...sourceFiles('app'), 'index.ts'].filter((f) =>
  fs.existsSync(path.join(ROOT, f))
);

const CALLS = {
  getSession: /\.getSession\s*\(/,
  onAuthStateChange: /\.onAuthStateChange\s*\(/,
} as const;

describe.each(Object.keys(CALLS) as (keyof typeof CALLS)[])('%s callers', (name) => {
  it('are only the reviewed ones (null session offline is not signed out; use readStoredSession or SIGNED_OUT)', () => {
    const callers = files.filter((f) => CALLS[name].test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    const unexpected = callers.filter((f) => !ALLOWED[f]?.[name]);
    expect(unexpected).toEqual([]);
  });
});

it('the allowlist has no stale entries', () => {
  for (const [file, calls] of Object.entries(ALLOWED)) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const name of Object.keys(calls) as (keyof typeof CALLS)[]) {
      expect([file, name, CALLS[name].test(src)]).toEqual([file, name, true]);
    }
  }
});
