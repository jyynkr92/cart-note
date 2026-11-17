import { onlineManager } from '@tanstack/react-query';
import { SessionUnavailableError } from './session-gate';

/**
 * 요청 도중 연결이 끊긴 오류. 큐 mutation은 멱등이고(삽입은 ON CONFLICT DO NOTHING, 삭제/이동은 id·조건으로 제한)
 * 일부 묶음만 적용된 상태에서 롤백하면 사용자의 의도가 사라지므로, 실패 대신 재시도해 mutation 전체를 다시 보낸다.
 */
export class RetryableNetworkError extends Error {
  constructor(cause: unknown) {
    super('network failure during a queued write', { cause });
    this.name = 'RetryableNetworkError';
  }
}

/**
 * 큐 mutation 재시도 정책. 세션 없음은 게이트가 닫혀 있으므로 지연 없이 재시도로 넘기면 retryer가 곧바로 pause한다
 * (영속화되고 onError의 롤백/토스트가 없다). 연결 오류도 재시도한다: 오프라인이면 즉시 pause되고, 온라인으로 보이면
 * 지수 백오프(최대 30초)로 다시 보낸다. 그 밖의 오류는 지금처럼 재시도 없이 실패한다(롤백 + 토스트).
 */
export function shouldRetryQueued(_failureCount: number, error: unknown): boolean {
  return error instanceof SessionUnavailableError || error instanceof RetryableNetworkError;
}

export function queuedRetryDelay(failureCount: number, error: unknown): number {
  if (error instanceof SessionUnavailableError || !onlineManager.isOnline()) return 0;
  return Math.min(1000 * 2 ** Math.max(0, failureCount - 1), 30_000);
}
