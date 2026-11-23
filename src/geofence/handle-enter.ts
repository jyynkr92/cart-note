import { canNotify } from './cooldown';
import {
  getCachedOpenCount,
  getGroupCount,
  getLastNotified,
  getRegionMeta,
  markNotified,
} from './geofence-store';
import { notificationText } from './notification-text';

/** 백그라운드 작업은 실행 시간이 짧다. 서버가 늦으면 기다리지 않고 캐시된 개수로 알린다. */
export const OPEN_COUNT_TIMEOUT_MS = 5_000;

export type EnterDeps = {
  now: number;
  hasSession(): Promise<boolean>;
  fetchOpenCount(listId: string): Promise<number>;
  notify(title: string, data: { listId: string; familyId: string }): Promise<void>;
  /** 테스트용. 기본값 OPEN_COUNT_TIMEOUT_MS */
  fetchTimeoutMs?: number;
};

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** 토큰 만료/무효(PostgREST JWT 오류, 401/403, 권한 없음)처럼 로그인 상태가 의심되는 오류. */
function isAuthError(e: unknown): boolean {
  const { code, status, message } = (e ?? {}) as { code?: unknown; status?: unknown; message?: unknown };
  if (code === 'PGRST301' || code === 'PGRST302' || code === '42501') return true;
  if (status === 401 || status === 403) return true;
  return typeof message === 'string' && /jwt/i.test(message);
}

/** 지오펜스 진입 처리. 로그아웃 상태, 모르는 region, 쿨다운 중, 살 것 0개면 알리지 않는다. */
export async function handleEnter(
  regionId: string,
  deps: EnterDeps
): Promise<'notified' | 'skipped'> {
  const signedIn = await deps.hasSession().catch(() => false);
  if (!signedIn) return 'skipped';

  const meta = (await getRegionMeta())[regionId];
  if (!meta) return 'skipped';
  if (!canNotify(meta.listId, deps.now, await getLastNotified())) return 'skipped';

  let count: number | null;
  try {
    count = await withTimeout(
      deps.fetchOpenCount(meta.listId),
      deps.fetchTimeoutMs ?? OPEN_COUNT_TIMEOUT_MS
    );
  } catch (e) {
    // 인증 오류면 그 사이 로그아웃했을 수 있다: 다시 확인하고 로그아웃이면 알리지 않는다.
    if (isAuthError(e) && !(await deps.hasSession().catch(() => false))) return 'skipped';
    count = await getCachedOpenCount(meta.listId);
  }
  if (count === 0) return 'skipped';

  const title = notificationText({
    groupName: meta.groupName,
    placeName: meta.placeName,
    count,
    groupCount: await getGroupCount(),
  });
  try {
    await deps.notify(title, { listId: meta.listId, familyId: meta.familyId });
  } catch {
    return 'skipped';
  }
  await markNotified(meta.listId, deps.now);
  return 'notified';
}
