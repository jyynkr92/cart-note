import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { useFamilyRealtime } from '@/src/realtime/use-family-realtime';
import * as applyChangeModule from '@/src/realtime/apply-change';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({
  supabase: { channel: jest.fn(), removeChannel: jest.fn() },
}));

type Handler = (p: unknown) => void;
let statusCb: (s: string) => void;
let handlers: { filter: { event: string; table: string; filter?: string }; cb: Handler }[];

const channel: any = {
  on: jest.fn((_t: string, filter: never, cb: Handler) => {
    handlers.push({ filter, cb });
    return channel;
  }),
  subscribe: jest.fn((cb: (s: string) => void) => {
    statusCb = cb;
    return channel;
  }),
};

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  handlers = [];
  jest.clearAllMocks();
  (supabase.channel as jest.Mock).mockReturnValue(channel);
  client = new QueryClient();
});
afterEach(() => client.clear());

it('does nothing without a family', async () => {
  await renderHook(() => useFamilyRealtime(null), { wrapper });
  expect(supabase.channel).not.toHaveBeenCalled();
});

it('subscribes INSERT/UPDATE with family filter and DELETE without one', async () => {
  await renderHook(() => useFamilyRealtime('f1'), { wrapper });
  expect((supabase.channel as jest.Mock).mock.calls[0][0]).toMatch(/^family:f1:/);
  const f = handlers.map((h) => h.filter);
  for (const table of ['items', 'lists', 'list_locations']) {
    expect(f).toContainEqual({
      event: 'INSERT',
      schema: 'public',
      table,
      filter: 'family_id=eq.f1',
    });
    expect(f).toContainEqual({
      event: 'UPDATE',
      schema: 'public',
      table,
      filter: 'family_id=eq.f1',
    });
    expect(f).toContainEqual({ event: 'DELETE', schema: 'public', table });
  }
});

type Pred = { predicate: (q: { queryKey: unknown[] }) => boolean };

it('invalidates everything but onboarding on every SUBSCRIBED, including the first', async () => {
  const spy = jest.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
  await renderHook(() => useFamilyRealtime('f1'), { wrapper });
  statusCb('SUBSCRIBED');
  expect(spy).toHaveBeenCalledTimes(1);
  const { predicate } = spy.mock.calls[0][0] as unknown as Pred;
  expect(predicate({ queryKey: ['items', 'l1'] })).toBe(true);
  expect(predicate({ queryKey: ['lists', 'f1'] })).toBe(true);
  expect(predicate({ queryKey: ['locations', 'l1'] })).toBe(true);
  expect(predicate({ queryKey: ['families'] })).toBe(true);
  // 온보딩 재조회가 오프라인에서 실패하면 가드가 오류 화면으로 바뀌므로 건드리지 않는다.
  expect(predicate({ queryKey: ['onboarding', 'u1'] })).toBe(false);
  // 진행 중인 조회를 취소하고 다시 시작하지 않는다(F1).
  expect(spy.mock.calls[0][1]).toEqual({ cancelRefetch: false });
  statusCb('CHANNEL_ERROR');
  statusCb('SUBSCRIBED');
  expect(spy).toHaveBeenCalledTimes(2);
});

it('while mutations are pending, SUBSCRIBED skips optimistic items, lists and locations', async () => {
  const spy = jest.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
  jest.spyOn(client, 'isMutating').mockReturnValue(1);
  await renderHook(() => useFamilyRealtime('f1'), { wrapper });
  statusCb('SUBSCRIBED');
  const { predicate } = spy.mock.calls[0][0] as unknown as Pred;
  expect(predicate({ queryKey: ['items', 'l1'] })).toBe(false);
  expect(predicate({ queryKey: ['lists', 'f1'] })).toBe(false);
  expect(predicate({ queryKey: ['locations', 'l1'] })).toBe(false);
  expect(predicate({ queryKey: ['onboarding', 'u1'] })).toBe(false);
  expect(predicate({ queryKey: ['allLocations'] })).toBe(true);
  expect(predicate({ queryKey: ['families'] })).toBe(true);
});

it('waits for postgres_changes subscription confirmation', async () => {
  await renderHook(() => useFamilyRealtime('f1'), { wrapper });
  expect(supabase.channel).toHaveBeenCalledWith(expect.any(String), {
    config: { postgres_changes_options: { wait: true } },
  });
});

it('ignores status callbacks after cleanup', async () => {
  const spy = jest.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
  const { unmount } = await renderHook(() => useFamilyRealtime('f1'), { wrapper });
  await unmount();
  statusCb('SUBSCRIBED');
  expect(spy).not.toHaveBeenCalled();
});

it('uses a distinct topic per effect so a leaving channel is never reused', async () => {
  const { rerender } = await renderHook(({ id }: { id: string | null }) => useFamilyRealtime(id), {
    wrapper,
    initialProps: { id: 'f1' as string | null },
  });
  await rerender({ id: 'f2' });
  await rerender({ id: 'f1' });
  const topics = (supabase.channel as jest.Mock).mock.calls.map((c) => c[0]);
  expect(topics).toHaveLength(3);
  expect(new Set(topics).size).toBe(3);
  expect(topics[0]).toMatch(/^family:f1:/);
  expect(channel.subscribe).toHaveBeenCalledTimes(3);
});

it('removes the channel on unmount and when the family changes', async () => {
  const { rerender, unmount } = await renderHook(
    ({ id }: { id: string | null }) => useFamilyRealtime(id),
    {
      wrapper,
      initialProps: { id: 'f1' as string | null },
    }
  );
  await rerender({ id: 'f2' });
  expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  expect((supabase.channel as jest.Mock).mock.calls.at(-1)![0]).toMatch(/^family:f2:/);
  await unmount();
  expect(supabase.removeChannel).toHaveBeenCalledTimes(2);
});

it('cancels pending realtime work when the subscription is torn down (M-4)', async () => {
  const cancel = jest.spyOn(applyChangeModule, 'cancelPendingRealtimeWork');
  const { unmount } = await renderHook(() => useFamilyRealtime('f1'), { wrapper });
  expect(cancel).not.toHaveBeenCalled();
  await unmount();
  expect(cancel).toHaveBeenCalledWith(client);
  cancel.mockRestore();
});
