/**
 * 낙관적 엔티티와 오프라인 큐의 계약.
 *
 * 큐 mutation 키 mk.X = ['m', <엔티티>, <동작>]의 <엔티티>는 그 mutation이 낙관적으로 고치는 쿼리 prefix와 같다.
 * 그런 prefix는 세 곳에서 모두 "큐가 빌 때만" 다뤄져야 한다. 하나라도 빠지면 대기 중인 낙관적 값이 서버 값으로 덮인다.
 *   1) invalidateWhenIdle: 큐가 비면 prefix 전체를 무효화하고, 바쁘면 아무것도 하지 않는다.
 *   2) Realtime 이벤트(applyChange): 큐가 바쁘면 그 prefix 캐시를 쓰거나 무효화하지 않는다.
 *   3) Realtime SUBSCRIBED 재조회: 큐가 바쁘면 그 prefix를 건너뛴다.
 * 새 낙관적 엔티티(mk에 새 <엔티티>)를 추가했는데 이 테스트가 실패하면 세 곳에 모두 등록한다.
 * 배경: docs/solutions/logic-errors/offline-queue-optimistic-state-clobbered-by-mid-queue-refetch.md
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { invalidateWhenIdle } from '@/src/lib/mutation-utils';
import { mk } from '@/src/lib/query-keys';
import { supabase } from '@/src/lib/supabase';
import { applyChange, type RealtimeTable } from '@/src/realtime/apply-change';
import { useFamilyRealtime } from '@/src/realtime/use-family-realtime';

jest.mock('@/src/lib/supabase', () => ({
  supabase: { channel: jest.fn(), removeChannel: jest.fn() },
}));

const ENTITIES = [
  ...new Set(
    Object.values(mk)
      .filter((k) => k.length > 1)
      .map((k) => String(k[1]))
  ),
];

let qc: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
});
afterEach(() => qc.clear());

/** 끝나지 않는 큐 mutation을 n개 띄운다(오프라인으로 쌓인 큐와 같은 상태). */
function holdQueue(n: number) {
  for (let i = 0; i < n; i++) {
    void qc
      .getMutationCache()
      .build(qc, {
        mutationKey: [...mk.all, 'contract', String(i)],
        mutationFn: () => new Promise<void>(() => {}),
        networkMode: 'always',
      })
      .execute(undefined)
      .catch(() => {});
  }
  expect(qc.isMutating({ mutationKey: mk.all })).toBe(n);
}

function seed() {
  const row = { id: 'r1', list_id: 'l1', family_id: 'f1', updated_at: '2026-01-01T00:00:00.000Z' };
  for (const e of ENTITIES) qc.setQueryData([e, 'scope'], [row]);
  return row;
}

const invalidated = (e: string) => qc.getQueryState([e, 'scope'])?.isInvalidated === true;

it('derives the optimistic entities from the mutation keys', () => {
  expect(ENTITIES.length).toBeGreaterThan(0);
});

describe.each(ENTITIES)('optimistic entity %s', (entity) => {
  it('is invalidated by invalidateWhenIdle when the queue drains', () => {
    seed();
    holdQueue(1); // onSettled 시점에는 끝나는 mutation 자신만 남아 있다
    invalidateWhenIdle(qc);
    expect(invalidated(entity)).toBe(true);
  });

  it('is left alone by invalidateWhenIdle while other mutations are queued', () => {
    seed();
    holdQueue(2);
    invalidateWhenIdle(qc);
    expect(invalidated(entity)).toBe(false);
  });

  it('is neither written nor invalidated by realtime events while the queue is busy', () => {
    const row = seed();
    holdQueue(1);
    const tables: RealtimeTable[] = ['items', 'lists', 'list_locations'];
    const incoming = { ...row, name: 'remote', updated_at: '2026-01-02T00:00:00.000Z' };
    for (const table of tables) {
      for (const eventType of ['INSERT', 'UPDATE', 'DELETE'] as const) {
        applyChange(qc, table, {
          eventType,
          new: incoming,
          old: { id: row.id },
          schema: 'public',
        } as any);
      }
    }
    expect(qc.getQueryData([entity, 'scope'])).toEqual([row]);
    expect(invalidated(entity)).toBe(false);
  });

  it('is skipped by the SUBSCRIBED refetch while the queue is busy', async () => {
    let statusCb: (s: string) => void = () => {};

    const channel: any = {
      on: jest.fn(() => channel),
      subscribe: jest.fn((cb: (s: string) => void) => {
        statusCb = cb;
        return channel;
      }),
    };
    (supabase.channel as jest.Mock).mockReturnValue(channel);
    seed();
    holdQueue(1);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    await renderHook(() => useFamilyRealtime('f1'), { wrapper });
    statusCb('SUBSCRIBED');
    expect(invalidated(entity)).toBe(false);
  });
});
