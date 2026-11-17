import type { QueryClient, UseMutationResult } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { mk } from './query-keys';
import { RetryableNetworkError } from './queue-retry';
import {
  hasLiveSession,
  markBackendUnreachable,
  markSessionUnavailable,
  SessionUnavailableError,
} from './session-gate';

/**
 * 모든 쓰기 mutation이 공유하는 scope. 같은 scope의 mutation은 순서대로 한 번에 하나씩 실행되므로
 * 오프라인에서 쌓인 큐(목록 생성 → 항목 추가 → 이동 → 비우기)가 입력 순서대로 재생된다.
 */
export const QUEUE_SCOPE = { id: 'cart-note-queue' } as const;

/**
 * 큐 mutation의 mutationFn을 감싼다: 요청 직전에 실제 세션이 있는지 확인하고, 없으면 게이트를 닫고
 * SessionUnavailableError를 던진다(재시도 정책이 pause로 보낸다). anon 키로 요청이 나가지 않게 한다.
 */
export function sessionGuarded<V>(run: (v: V) => Promise<void>): (v: V) => Promise<void> {
  return async (v: V) => {
    if (!(await hasLiveSession())) {
      markSessionUnavailable();
      throw new SessionUnavailableError();
    }
    try {
      await run(v);
    } catch (e) {
      // 요청 도중 연결이 끊겼다: 게이트를 닫아 재시도 정책이 곧바로 pause(영속화)하게 한다.
      if (e instanceof RetryableNetworkError) markBackendUnreachable();
      throw e;
    }
  };
}

export function newId(): string {
  return randomUUID();
}

/**
 * 큐가 모두 비었을 때(마지막 mutation이 끝났을 때) 항목/목록/지점 캐시 전체를 서버 상태로 다시 맞춘다.
 * 중간에는 건너뛰어 낙관적 값이 깜빡이지 않게 하고, 먼저 끝난 mutation이 건드린 목록도 빠짐없이 갱신한다.
 */
export function invalidateWhenIdle(qc: QueryClient) {
  if (qc.isMutating({ mutationKey: mk.all }) > 1) return;
  void qc.invalidateQueries({ queryKey: ['items'] });
  void qc.invalidateQueries({ queryKey: ['lists'] });
  void qc.invalidateQueries({ queryKey: ['locations'] });
  void qc.invalidateQueries({ queryKey: ['allLocations'] });
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
