import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { useFamilyRealtime } from '@/src/realtime/use-family-realtime';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({ supabase: { channel: jest.fn(), removeChannel: jest.fn() } }));

type Handler = (p: unknown) => void;
let statusCb: (s: string) => void;
let handlers: { filter: { event: string; table: string; filter?: string }; cb: Handler }[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  expect(supabase.channel).toHaveBeenCalledWith('family:f1');
  const f = handlers.map((h) => h.filter);
  for (const table of ['items', 'lists', 'list_locations']) {
    expect(f).toContainEqual({ event: 'INSERT', schema: 'public', table, filter: 'family_id=eq.f1' });
    expect(f).toContainEqual({ event: 'UPDATE', schema: 'public', table, filter: 'family_id=eq.f1' });
    expect(f).toContainEqual({ event: 'DELETE', schema: 'public', table });
  }
});

it('invalidates everything on re-SUBSCRIBED, not on the first one', async () => {
  const spy = jest.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
  await renderHook(() => useFamilyRealtime('f1'), { wrapper });
  statusCb('SUBSCRIBED');
  expect(spy).not.toHaveBeenCalled();
  statusCb('CHANNEL_ERROR');
  statusCb('SUBSCRIBED');
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith();
});

it('removes the channel on unmount and when the family changes', async () => {
  const { rerender, unmount } = await renderHook(({ id }: { id: string | null }) => useFamilyRealtime(id), {
    wrapper,
    initialProps: { id: 'f1' as string | null },
  });
  await rerender({ id: 'f2' });
  expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  expect(supabase.channel).toHaveBeenLastCalledWith('family:f2');
  await unmount();
  expect(supabase.removeChannel).toHaveBeenCalledTimes(2);
});
