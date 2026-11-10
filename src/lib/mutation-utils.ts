import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { mk } from './query-keys';

/**
 * 모든 쓰기 mutation이 공유하는 scope. 같은 scope의 mutation은 순서대로 한 번에 하나씩 실행되므로
 * 오프라인에서 쌓인 큐(목록 생성 → 항목 추가 → 이동 → 비우기)가 입력 순서대로 재생된다.
 */
export const QUEUE_SCOPE = { id: 'cart-note-queue' } as const;

export function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // randomUUID가 없는 런타임용 v4 폴백
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** 마지막 남은 mutation이 끝났을 때만 서버 상태로 다시 맞춘다(낙관적 값이 중간에 깜빡이지 않게). */
export function invalidateWhenIdle(qc: QueryClient, keys: QueryKey[]) {
  if (qc.isMutating({ mutationKey: mk.all }) > 1) return;
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
}
