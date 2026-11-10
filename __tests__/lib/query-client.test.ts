import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/react-query-persist-client';
import * as itemApi from '@/src/items/item-api';
import type { Item } from '@/src/items/item-api';
import { useClearList, useMoveItems } from '@/src/items/use-items';
import {
  clearUserCache,
  createQueryClient as createRawQueryClient,
  persistOptions,
  persister,
  syncCacheOwner,
} from '@/src/lib/query-client';
import { qk } from '@/src/lib/query-keys';

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
const api = itemApi as jest.Mocked<typeof itemApi>;

const clients: ReturnType<typeof createRawQueryClient>[] = [];
const createQueryClient = () => {
  const c = createRawQueryClient();
  clients.push(c);
  return c;
};
afterEach(() => {
  for (const c of clients.splice(0)) c.clear();
});

const item = (id: string, listId = 'l1'): Item => ({
  id,
  list_id: listId,
  family_id: 'f1',
  name: id,
  note: null,
  is_done: false,
  done_at: null,
  sort_order: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  created_by: null,
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  onlineManager.setOnline(true);
  for (const fn of Object.values(api))
    if (jest.isMockFunction(fn)) fn.mockResolvedValue(undefined as never);
});

describe('offline queue (Review Focus 5)', () => {
  it('replays move then clear in order after a restart', async () => {
    onlineManager.setOnline(false);
    const first = createQueryClient();
    first.setQueryData(qk.items('l1'), [item('a'), item('b')]);
    first.setQueryData(qk.items('l2'), [item('c', 'l2')]);

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: first }, children);
    const move = await renderHook(() => useMoveItems(), { wrapper });
    const clear = await renderHook(() => useClearList(), { wrapper });
    await act(async () => {
      move.result.current.mutate({ fromListId: 'l1', toListId: 'l2', ids: ['a'] });
      clear.result.current.mutate({ listId: 'l2' });
    });

    const paused = () =>
      first
        .getMutationCache()
        .getAll()
        .filter((m) => m.state.isPaused);
    await waitFor(() => expect(paused()).toHaveLength(2));
    expect(api.moveItems).not.toHaveBeenCalled();
    expect(api.clearListItems).not.toHaveBeenCalled();

    await persistQueryClientSave({
      queryClient: first,
      persister,
      dehydrateOptions: persistOptions.dehydrateOptions,
    });
    first.clear();

    // 앱 재시작: 새 QueryClient로 복원
    const second = createQueryClient();
    await persistQueryClientRestore({ queryClient: second, persister });
    expect(second.getMutationCache().getAll()).toHaveLength(2);
    expect(second.getQueryData<Item[]>(qk.items('l2'))!.map((i) => i.id)).toEqual([]);

    const calls: string[] = [];
    api.moveItems.mockImplementation(async () => void calls.push('move'));
    api.clearListItems.mockImplementation(async () => void calls.push('clear'));
    onlineManager.setOnline(true);
    await second.resumePausedMutations();

    expect(calls).toEqual(['move', 'clear']);
    expect(api.moveItems).toHaveBeenCalledWith('l2', ['a']);
    expect(api.clearListItems).toHaveBeenCalledWith('l2');
    second.clear();
  });
});

describe('privacy: persisted cache', () => {
  it('clearUserCache wipes memory and storage', async () => {
    const client = createQueryClient();
    client.setQueryData(qk.items('l1'), [item('secret')]);
    await persistQueryClientSave({ queryClient: client, persister });
    expect(await persister.restoreClient()).toBeDefined();

    await clearUserCache(client);

    expect(client.getQueryData(qk.items('l1'))).toBeUndefined();
    expect(await persister.restoreClient()).toBeUndefined();
  });

  it('syncCacheOwner clears when the signed-in user changes or signs out', async () => {
    const client = createQueryClient();
    await syncCacheOwner(client, 'u1');
    client.setQueryData(qk.items('l1'), [item('a')]);

    await syncCacheOwner(client, 'u1');
    expect(client.getQueryData(qk.items('l1'))).toBeDefined();

    await syncCacheOwner(client, 'u2');
    expect(client.getQueryData(qk.items('l1'))).toBeUndefined();

    client.setQueryData(qk.items('l1'), [item('b')]);
    await syncCacheOwner(client, null);
    expect(client.getQueryData(qk.items('l1'))).toBeUndefined();
  });

  it('does not persist onboarding state', () => {
    const client = createQueryClient();
    client.setQueryData(qk.onboarding('u1'), { step: 'profile' });
    client.setQueryData(qk.items('l1'), []);
    const keep = persistOptions.dehydrateOptions!.shouldDehydrateQuery!;
    const queries = client.getQueryCache().getAll();
    expect(queries.filter((q) => keep(q)).map((q) => q.queryKey[0])).toEqual(['items']);
  });
});
