import type { QueryClient, UseMutationResult } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { mk } from './query-keys';

/**
 * 모든 쓰기 mutation이 공유하는 scope. 같은 scope의 mutation은 순서대로 한 번에 하나씩 실행되므로
 * 오프라인에서 쌓인 큐(목록 생성 → 항목 추가 → 이동 → 비우기)가 입력 순서대로 재생된다.
 */
export const QUEUE_SCOPE = { id: 'cart-note-queue' } as const;

export function newId(): string {
  return randomUUID();
}

/**
 * 큐가 모두 비었을 때(마지막 mutation이 끝났을 때) 항목/목록 캐시 전체를 서버 상태로 다시 맞춘다.
 * 중간에는 건너뛰어 낙관적 값이 깜빡이지 않게 하고, 먼저 끝난 mutation이 건드린 목록도 빠짐없이 갱신한다.
 */
export function invalidateWhenIdle(qc: QueryClient) {
  if (qc.isMutating({ mutationKey: mk.all }) > 1) return;
  void qc.invalidateQueries({ queryKey: ['items'] });
  void qc.invalidateQueries({ queryKey: ['lists'] });
}

/**
 * 입력을 변수로 바꾸는 `prepare`가 null을 돌려주면(예: 공백뿐인 이름) mutation을 실행하지 않는다.
 * id/시각처럼 재실행에도 같아야 하는 값은 prepare에서 만들어 변수에 담는다(영속화됨).
 */
export function withPrepare<I, V>(
  m: UseMutationResult<void, Error, V, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  prepare: (input: I) => V | null
) {
  return {
    ...m,
    mutate: (input: I) => {
      const vars = prepare(input);
      if (vars) m.mutate(vars);
    },
    mutateAsync: async (input: I) => {
      const vars = prepare(input);
      if (vars) await m.mutateAsync(vars);
    },
  };
}
