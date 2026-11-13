import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { disposeClient } from '@/test-utils/dispose-client';
import * as api from '@/src/items/item-api';
import type { Item } from '@/src/items/item-api';
import {
  useAddItem,
  useClearDone,
  useClearList,
  useMoveItems,
  useToggleItem,
  useUpdateItem,
} from '@/src/items/use-items';
import { createQueryClient } from '@/src/lib/query-client';
import { qk } from '@/src/lib/query-keys';
import { toast } from '@/src/lib/toast';

jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/src/lib/toast', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/src/items/item-api', () => ({
  fetchItems: jest.fn(),
  insertItem: jest.fn(),
  updateItem: jest.fn(),
  deleteItems: jest.fn(),
  clearDoneItems: jest.fn(),
  clearListItems: jest.fn(),
  moveItems: jest.fn(),
}));

const mocked = api as jest.Mocked<typeof api>;

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  list_id: 'l1',
  family_id: 'f1',
  name: id,
  note: null,
  is_done: false,
  done_at: null,
  sort_order: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  created_by: null,
  ...over,
});

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  onlineManager.setOnline(true);
  client = createQueryClient();
  for (const fn of Object.values(mocked))
    if (jest.isMockFunction(fn)) fn.mockResolvedValue(undefined as never);
});

afterEach(() => disposeClient(client));

it('does not run a mutation for a blank name', async () => {
  const { result } = await renderHook(() => useAddItem(), { wrapper });
  await act(async () => {
    result.current.mutate({ listId: 'l1', familyId: 'f1', name: '  ' });
  });
  expect(mocked.insertItem).not.toHaveBeenCalled();
  expect(client.getQueryData(qk.items('l1'))).toBeUndefined();
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});

it('adds optimistically with a client id and trimmed name', async () => {
  client.setQueryData(qk.items('l1'), [item('a')]);
  const { result } = await renderHook(() => useAddItem(), { wrapper });
  await act(async () => {
    result.current.mutate({ listId: 'l1', familyId: 'f1', name: '  우유 ' });
  });
  const [call] = mocked.insertItem.mock.calls;
  expect(call[0]).toMatchObject({ listId: 'l1', familyId: 'f1', name: '우유' });
  expect(call[0].id).toEqual(expect.any(String));
  const cached = client.getQueryData<Item[]>(qk.items('l1'))!;
  expect(cached.map((i) => i.name)).toEqual(['a', '우유']);
  expect(cached[1].id).toBe(call[0].id);
});

it('rolls back an optimistic toggle when the api rejects, and toasts', async () => {
  const original = [item('a')];
  client.setQueryData(qk.items('l1'), original);
  mocked.updateItem.mockRejectedValue(new Error('boom'));
  const { result } = await renderHook(() => useToggleItem(), { wrapper });

  await act(async () => {
    await result.current.mutateAsync({ item: original[0] }).catch(() => {});
  });
  expect(client.getQueryData(qk.items('l1'))).toEqual(original);
  expect(toast.error).toHaveBeenCalledTimes(1);
});

it('toggles optimistically, setting and clearing done_at', async () => {
  const a = item('a');
  client.setQueryData(qk.items('l1'), [a]);
  let release!: () => void;
  mocked.updateItem.mockReturnValue(new Promise<void>((r) => (release = r)) as never);
  const { result } = await renderHook(() => useToggleItem(), { wrapper });
  await act(async () => {
    result.current.mutate({ item: a });
  });
  const [done] = client.getQueryData<Item[]>(qk.items('l1'))!;
  expect(done.is_done).toBe(true);
  expect(done.done_at).toEqual(expect.any(String));
  await act(async () => release());
  expect(mocked.updateItem).toHaveBeenCalledWith('a', { is_done: true, done_at: done.done_at });
});

it('uses one done_at for the optimistic cache and the api call', async () => {
  const a = item('a');
  client.setQueryData(qk.items('l1'), [a]);
  jest.useFakeTimers({
    now: new Date('2026-02-01T00:00:00.000Z'),
    doNotFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'clearImmediate',
      'nextTick',
      'queueMicrotask',
      'performance',
      'hrtime',
    ],
  });
  try {
    // 낙관적 반영 직후 시계를 앞으로 보낸다: mutationFn이 시간을 다시 계산하면 값이 달라진다.
    const orig = client.setQueryData.bind(client);
    jest.spyOn(client, 'setQueryData').mockImplementation(((...args: Parameters<typeof orig>) => {
      const r = orig(...args);
      jest.setSystemTime(new Date('2026-02-01T00:00:05.000Z'));
      return r;
    }) as typeof client.setQueryData);
    const { result } = await renderHook(() => useToggleItem(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ item: a });
    });
    const [done] = client.getQueryData<Item[]>(qk.items('l1'))!;
    expect(mocked.updateItem).toHaveBeenCalledWith('a', { is_done: true, done_at: done.done_at });
  } finally {
    jest.useRealTimers();
  }
});

it('moves items out of the source cache and into the target cache', async () => {
  client.setQueryData(qk.items('l1'), [item('a'), item('b')]);
  client.setQueryData(qk.items('l2'), [item('c', { list_id: 'l2' })]);
  const { result } = await renderHook(() => useMoveItems(), { wrapper });
  await act(async () => {
    result.current.mutate({ fromListId: 'l1', toListId: 'l2', ids: ['a'] });
  });
  expect(client.getQueryData<Item[]>(qk.items('l1'))!.map((i) => i.id)).toEqual(['b']);
  const target = client.getQueryData<Item[]>(qk.items('l2'))!;
  expect(target.map((i) => i.id).sort()).toEqual(['a', 'c']);
  expect(target.find((i) => i.id === 'a')!.list_id).toBe('l2');
  expect(mocked.moveItems).toHaveBeenCalledWith('l2', ['a']);
});

it('clears only done items from the cache', async () => {
  client.setQueryData(qk.items('l1'), [
    item('open'),
    item('done', { is_done: true, done_at: '2026-01-02T00:00:00.000Z' }),
  ]);
  const { result } = await renderHook(() => useClearDone(), { wrapper });
  await act(async () => {
    result.current.mutate({ listId: 'l1' });
  });
  expect(client.getQueryData<Item[]>(qk.items('l1'))!.map((i) => i.id)).toEqual(['open']);
  // 재실행 때 다시 고르지 않도록 지울 id를 변수에 담는다(A2).
  expect(client.getMutationCache().getAll()[0].state.variables).toEqual({
    listId: 'l1',
    ids: ['done'],
  });
  expect(mocked.clearDoneItems).toHaveBeenCalledWith('l1', ['done']);
});

it('clears the whole list from the cache', async () => {
  client.setQueryData(qk.items('l1'), [item('a'), item('b')]);
  const { result } = await renderHook(() => useClearList(), { wrapper });
  await act(async () => {
    result.current.mutate({ listId: 'l1' });
  });
  expect(client.getQueryData(qk.items('l1'))).toEqual([]);
  expect(client.getMutationCache().getAll()[0].state.variables).toEqual({
    listId: 'l1',
    ids: ['a', 'b'],
  });
  expect(mocked.clearListItems).toHaveBeenCalledWith('l1', ['a', 'b']);
});

it('does not run a clear when nothing in the cache matches', async () => {
  client.setQueryData(qk.items('l1'), [item('open')]);
  const { result } = await renderHook(() => useClearDone(), { wrapper });
  await act(async () => {
    result.current.mutate({ listId: 'l1' });
  });
  expect(mocked.clearDoneItems).not.toHaveBeenCalled();
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});

it('ignores a whitespace-only item name on update', async () => {
  client.setQueryData(qk.items('l1'), [item('a')]);
  const { result } = await renderHook(() => useUpdateItem(), { wrapper });
  await act(async () => {
    result.current.mutate({ id: 'a', name: '  ' });
    await result.current.mutateAsync({ id: 'a', name: '\t' });
  });
  expect(mocked.updateItem).not.toHaveBeenCalled();
  expect(client.getQueryData<Item[]>(qk.items('l1'))![0].name).toBe('a');
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});
