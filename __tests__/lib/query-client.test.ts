import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/react-query-persist-client';
import { disposeClient } from '@/test-utils/dispose-client';
import * as itemApi from '@/src/items/item-api';
import type { Item } from '@/src/items/item-api';
import { useClearList, useDeleteItems, useItems, useMoveItems } from '@/src/items/use-items';
import {
  clearUserCache,
  createQueryClient as createRawQueryClient,
  persistOptions,
  persister,
  syncCacheOwner,
} from '@/src/lib/query-client';
import { qk } from '@/src/lib/query-keys';
import * as realtime from '@/src/realtime/apply-change';

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
afterEach(async () => {
  // 훅을 먼저 언마운트해야 observer 제거가 dispose 이후에 gc 타이머를 다시 만들지 않는다.
  await cleanup();
  for (const c of clients.splice(0)) disposeClient(c);
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
    });
    // 비우기는 이동 결과(낙관적 반영)가 화면에 보인 뒤에 누른다.
    await act(async () => {
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
    disposeClient(first);

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
    // 재실행 때도 원래 목록에 남아 있는 항목만 옮긴다(M-5).
    expect(api.moveItems).toHaveBeenCalledWith('l2', ['a'], 'l1');
    // 오프라인에서 보이던 항목(c, 옮겨 온 a)만 지운다. 그 사이 다른 멤버가 l2에 넣은 항목은 남는다(A2).
    expect(api.clearListItems).toHaveBeenCalledTimes(1);
    expect(api.clearListItems).toHaveBeenCalledWith('l2', ['c', 'a']);
    disposeClient(second);
  });
});

describe('persisted queue lifetime (A1)', () => {
  it('restores and resumes a paused mutation saved two days ago', async () => {
    onlineManager.setOnline(false);
    const first = createQueryClient();
    first.setQueryData(qk.items('l1'), [item('a'), item('b')]);
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: first }, children);
    const del = await renderHook(() => useDeleteItems(), { wrapper });
    await act(async () => {
      del.result.current.mutate({ listId: 'l1', ids: ['a'] });
    });
    await waitFor(() =>
      expect(first.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1)
    );

    await persistQueryClientSave({
      queryClient: first,
      persister,
      buster: persistOptions.buster,
      dehydrateOptions: persistOptions.dehydrateOptions,
    });
    // 이틀 전에 저장된 캐시로 만든다(Date.now를 바꾸면 persister의 쓰기 throttle이 멈춘다).
    const saved = (await persister.restoreClient())!;
    await persister.removeClient();
    await AsyncStorage.setItem(
      'cart-note-query-cache',
      JSON.stringify({ ...saved, timestamp: saved.timestamp - 2 * 24 * 60 * 60 * 1000 })
    );
    disposeClient(first);

    const second = createQueryClient();
    await persistQueryClientRestore({
      queryClient: second,
      persister,
      maxAge: persistOptions.maxAge,
      buster: persistOptions.buster,
    });
    expect(second.getMutationCache().getAll()).toHaveLength(1);

    onlineManager.setOnline(true);
    await second.resumePausedMutations();
    expect(api.deleteItems).toHaveBeenCalledWith(['a']);
    disposeClient(second);
  });
});

describe('queue drain reconciliation', () => {
  it.each([
    ['fails', true],
    ['succeeds', false],
  ])('reconciles every touched list when the first resumed mutation %s', async (_n, fails) => {
    onlineManager.setOnline(false);
    const first = createQueryClient();
    first.setQueryData(qk.items('l1'), [item('a'), item('b')]);
    first.setQueryData(qk.items('l2'), [item('c', 'l2')]);
    const w1 = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: first }, children);
    const del = await renderHook(() => useDeleteItems(), { wrapper: w1 });
    const clear = await renderHook(() => useClearList(), { wrapper: w1 });
    await act(async () => {
      del.result.current.mutate({ listId: 'l1', ids: ['a'] });
      clear.result.current.mutate({ listId: 'l2' });
    });
    await waitFor(() =>
      expect(
        first
          .getMutationCache()
          .getAll()
          .filter((m) => m.state.isPaused)
      ).toHaveLength(2)
    );
    await persistQueryClientSave({
      queryClient: first,
      persister,
      dehydrateOptions: persistOptions.dehydrateOptions,
    });
    disposeClient(first);

    const second = createQueryClient();
    await persistQueryClientRestore({ queryClient: second, persister });
    const w2 = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: second }, children);
    // 재연결 자동 refetch가 결과를 가리지 않도록 끈다(큐 정리 로직만 검증).
    second.setQueryDefaults(['items'], { refetchOnReconnect: false });
    const l1 = await renderHook(() => useItems('l1'), { wrapper: w2 });
    const l2 = await renderHook(() => useItems('l2'), { wrapper: w2 });

    // 서버 상태: 실패하면 a, b가 남고, 성공해도 다른 멤버가 z를 추가해 둔 상태. l2는 비어 있다.
    const server: Record<string, Item[]> = {
      l1: fails ? [item('a'), item('b')] : [item('b'), item('z')],
      l2: [],
    };
    api.fetchItems.mockImplementation(async (id: string) => server[id]);
    if (fails) api.deleteItems.mockRejectedValue(new Error('rls'));
    onlineManager.setOnline(true);
    await act(async () => {
      await second.resumePausedMutations();
    });

    const expected = fails ? ['a', 'b'] : ['b', 'z'];
    await waitFor(() => expect(l1.result.current.data!.map((i) => i.id).sort()).toEqual(expected));
    expect(l2.result.current.data).toEqual([]);
    disposeClient(second);
  });
});

describe('privacy: persisted cache', () => {
  it('clearUserCache cancels pending realtime work (M-4)', async () => {
    const client = createQueryClient();
    const cancel = jest.spyOn(realtime, 'cancelPendingRealtimeWork');
    await clearUserCache(client);
    expect(cancel).toHaveBeenCalledWith(client);
    cancel.mockRestore();
  });

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

    // 로그아웃 뒤에는 소유자 기록이 없으므로 같은 사용자의 재로그인도 비운다(캐시는 이미 비어 있다).
    client.setQueryData(qk.items('l1'), [item('c')]);
    await syncCacheOwner(client, 'u2');
    expect(client.getQueryData(qk.items('l1'))).toBeUndefined();

    // 이후 같은 사용자는 유지한다.
    client.setQueryData(qk.items('l1'), [item('d')]);
    await syncCacheOwner(client, 'u2');
    expect(client.getQueryData(qk.items('l1'))).toBeDefined();
  });

  it('syncCacheOwner clears a cache with no recorded owner', async () => {
    const client = createQueryClient();
    await AsyncStorage.clear();
    client.setQueryData(qk.items('l1'), [item('a')]);
    await syncCacheOwner(client, 'u1');
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
