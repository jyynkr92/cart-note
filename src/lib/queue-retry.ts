import { onlineManager } from '@tanstack/react-query';
import { SessionUnavailableError } from './session-gate';

/**
 * 큐 mutation 재시도 정책. 세션 없음은 게이트가 닫혀 있으므로 지연 없이 재시도로 넘기면 retryer가 곧바로 pause한다
 * (영속화되고 onError의 롤백/토스트가 없다). 그 밖의 오류는 지금처럼 재시도 없이 실패한다.
 */
export function shouldRetryQueued(_failureCount: number, error: unknown): boolean {
  return error instanceof SessionUnavailableError;
}

export function queuedRetryDelay(_failureCount: number, error: unknown): number {
  if (error instanceof SessionUnavailableError || !onlineManager.isOnline()) return 0;
  return 1000;
}
