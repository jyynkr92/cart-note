import { onlineManager } from '@tanstack/react-query';

/**
 * 쓰기 큐(그리고 쿼리)를 "네트워크 연결 AND 소유자가 확인된 세션"일 때만 진행시키는 게이트.
 *
 * TanStack의 onlineManager는 QueryClient.mount()가 구독해 오프라인→온라인마다 resumePausedMutations()를 부른다.
 * 세션 없이(오프라인 갱신 실패 등) 큐가 재생되면 supabase-js가 anon 키로 요청해 RLS가 0행만 바꾸고 "성공"하거나
 * 삽입이 42501로 롤백돼 쓰기가 조용히 사라진다. 그래서 onlineManager를 network && session으로 만든다.
 * - openSession: reconcileCacheOwner가 디스크 캐시 소유자를 확인한 뒤에만 연다(그 사용자의 큐만 재생).
 * - sessionRestored: 같은 사용자의 세션이 돌아오면(TOKEN_REFRESHED 등) 다시 연다. 다른 사용자는 열지 않는다.
 * - 각 큐 mutation은 요청 직전에 hasLiveSession()을 다시 확인하고, 없으면 게이트를 닫고 SessionUnavailableError를
 *   던진다 → 재시도 정책이 즉시 pause로 보내므로 영속화된 채 남고 롤백/토스트가 없다.
 */
export class SessionUnavailableError extends Error {
  constructor() {
    super('session unavailable');
    this.name = 'SessionUnavailableError';
  }
}

let network: boolean | null = null; // null = 아직 모름(NetInfo 연결 전, 테스트)
let ready = false;
let verifiedUserId: string | null = null;
/** 테스트용: 어떤 확인된 사용자와도 일치하는 세션(jest.setup이 설치). 앱 코드는 쓰지 않는다. */
export const ANY_USER_SESSION = '*any-user*';

// 기본값은 "세션 없음"(fail closed). 앱은 app/_layout에서 getSession 기반 확인을 설치한다.
const noSession = async (): Promise<string | null> => null;
let check: () => Promise<string | null> = noSession;
const networkListeners = new Set<() => void>();

function apply() {
  onlineManager.setOnline((network ?? true) && ready);
}

/** 실제 세션 확인(세션 사용자 id, 없으면 null). 앱 시작 시 supabase.auth.getSession 기반으로 설치한다. */
export function installSessionCheck(fn: () => Promise<string | null>): void {
  check = fn;
}

/**
 * 요청 직전 확인: 살아 있는 세션이 있고 그 사용자가 게이트를 연(소유자 확인된) 사용자와 같은지.
 * 실패는 세션 없음으로 본다.
 */
export async function hasLiveSession(): Promise<boolean> {
  let uid: string | null;
  try {
    uid = await check();
  } catch {
    return false;
  }
  return uid !== null && (uid === ANY_USER_SESSION || uid === verifiedUserId);
}

export function setNetworkOnline(v: boolean): void {
  network = v;
  apply();
  for (const l of networkListeners) l();
}

/** 네트워크 연결 상태(세션과 무관). 모르면 null. 오프라인 배너는 이것을 쓴다. */
export function getNetworkOnline(): boolean | null {
  return network;
}

export function subscribeNetwork(l: () => void): () => void {
  networkListeners.add(l);
  return () => void networkListeners.delete(l);
}

/** 소유자 확인이 끝난 사용자의 세션으로 게이트를 연다. */
export function openSession(userId: string): void {
  verifiedUserId = userId;
  ready = true;
  apply();
}

/** 로그아웃/세션 없음: 게이트를 닫고 확인된 사용자도 잊는다. */
export function closeSession(): void {
  verifiedUserId = null;
  ready = false;
  apply();
}

/**
 * 세션이 돌아왔을 때: 이미 확인된 같은 사용자일 때만 다시 연다. 다른 사용자의 세션이면 게이트를 닫는다
 * (그 사용자의 소유자 확인은 reconcileCacheOwner가 하고 나서 연다).
 */
export function sessionRestored(userId: string): void {
  ready = userId === verifiedUserId;
  apply();
}

/** 요청 직전 확인에서 세션이 없었다: 확인된 사용자는 두고 게이트만 닫는다. */
export function markSessionUnavailable(): void {
  ready = false;
  apply();
}

export function isSessionOpen(): boolean {
  return ready;
}

/** 테스트용 초기화(onlineManager는 건드리지 않는다). */
export function resetSessionGateForTests(): void {
  network = null;
  ready = false;
  verifiedUserId = null;
  check = noSession;
  networkListeners.clear();
}
