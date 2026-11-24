import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { disposeClient } from '@/test-utils/dispose-client';
import * as api from '@/src/lists/list-api';
import type { List } from '@/src/lists/list-api';
import { sortLists } from '@/src/lists/ListCard';
import {
  nextSortOrder,
  useCreateList,
  useLists,
  useRenameList,
  useReorderLists,
} from '@/src/lists/use-lists';
import { createQueryClient } from '@/src/lib/query-client';
import { qk } from '@/src/lib/query-keys';
import { applyChange } from '@/src/realtime/apply-change';
import { toast } from '@/src/lib/toast';

jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/src/lib/toast', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/src/items/item-api', () => ({}));
jest.mock('@/src/lists/list-api', () => ({
  fetchLists: jest.fn(),
  insertList: jest.fn(),
  renameList: jest.fn(),
  deleteList: jest.fn(),
  reorderLists: jest.fn(),
}));
const mocked = api as jest.Mocked<typeof api>;

const list: List = {
  id: 'l1',
  family_id: 'f1',
  name: '마트',
  kind: 'store',
  sort_order: 0,
  created_at: '2026-01-01T00:00:00.000Z',
};

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
  client.setQueryData(qk.lists('f1'), [list]);
});
afterEach(() => disposeClient(client));

it('ignores a whitespace-only name when creating a list', async () => {
  const { result } = await renderHook(() => useCreateList(), { wrapper });
  await act(async () => {
    result.current.mutate({ familyId: 'f1', name: '   ' });
    await result.current.mutateAsync({ familyId: 'f1', name: ' ' });
  });
  expect(mocked.insertList).not.toHaveBeenCalled();
  expect(client.getQueryData<List[]>(qk.lists('f1'))).toEqual([list]);
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});

it('ignores a whitespace-only name when renaming a list', async () => {
  const { result } = await renderHook(() => useRenameList(), { wrapper });
  await act(async () => {
    result.current.mutate({ id: 'l1', familyId: 'f1', name: '  ' });
    await result.current.mutateAsync({ id: 'l1', familyId: 'f1', name: '' });
  });
  expect(mocked.renameList).not.toHaveBeenCalled();
  expect(client.getQueryData<List[]>(qk.lists('f1'))![0].name).toBe('마트');
});

const T = (d: number) => `2026-01-0${d}T00:00:00.000Z`;
const mk_ = (id: string, over: Partial<List> = {}): List => ({
  ...list,
  id,
  name: id,
  ...over,
});
const ids = (ls: List[] | undefined) => sortLists(ls ?? []).map((l) => l.id);

/** 끝나지 않은 api 호출을 손으로 끝낸다. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('nextSortOrder', () => {
  it('is 1 for no lists or only the inbox', () => {
    expect(nextSortOrder([])).toBe(1);
    expect(nextSortOrder([mk_('in', { kind: 'inbox', sort_order: 9 })])).toBe(1);
  });

  it('is max + 1 over non-inbox lists, at least 1', () => {
    expect(nextSortOrder([mk_('a', { sort_order: 0 }), mk_('b', { sort_order: 0 })])).toBe(1);
    expect(
      nextSortOrder([
        mk_('a', { sort_order: 1 }),
        mk_('b', { sort_order: 3 }),
        mk_('in', { kind: 'inbox', sort_order: 7 }),
      ])
    ).toBe(4);
  });
});

describe('create sends max+1 sort_order', () => {
  it('carries nextSortOrder of the cache in the variables, the request and the optimistic row', async () => {
    client.setQueryData(qk.lists('f1'), [
      mk_('in', { kind: 'inbox', sort_order: 9 }),
      mk_('a', { sort_order: 1 }),
      mk_('b', { sort_order: 3 }),
    ]);
    const { result } = await renderHook(() => useCreateList(), { wrapper });
    await act(async () => {
      result.current.mutate({ familyId: 'f1', name: '코스트코' });
    });
    const [[sent]] = mocked.insertList.mock.calls;
    expect(sent).toMatchObject({ familyId: 'f1', name: '코스트코', sortOrder: 4 });
    const created = client.getQueryData<List[]>(qk.lists('f1'))!.find((l) => l.id === sent.id)!;
    expect(created.sort_order).toBe(4);
    expect(ids(client.getQueryData<List[]>(qk.lists('f1')))).toEqual(['in', 'a', 'b', sent.id]);
  });

  it('uses 1 when the lists are not cached', async () => {
    client.removeQueries({ queryKey: qk.lists('f1') });
    const { result } = await renderHook(() => useCreateList(), { wrapper });
    await act(async () => {
      result.current.mutate({ familyId: 'f1', name: '코스트코' });
    });
    expect(mocked.insertList.mock.calls[0][0]).toMatchObject({ sortOrder: 1 });
  });
});

describe('reorder', () => {
  const family = () => [
    mk_('in', { kind: 'inbox', sort_order: 5 }),
    mk_('a', { sort_order: 1, created_at: T(1) }),
    mk_('b', { sort_order: 2, created_at: T(2) }),
    mk_('c', { sort_order: 3, created_at: T(3) }),
  ];

  it('does nothing for empty ids', async () => {
    client.setQueryData(qk.lists('f1'), family());
    const { result } = await renderHook(() => useReorderLists(), { wrapper });
    await act(async () => {
      result.current.mutate({ familyId: 'f1', ids: [] });
    });
    expect(mocked.reorderLists).not.toHaveBeenCalled();
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  it('calls the api with the family and ids and applies the order optimistically', async () => {
    client.setQueryData(qk.lists('f1'), family());
    const pending = deferred();
    mocked.reorderLists.mockReturnValue(pending.promise);
    const { result } = await renderHook(() => useReorderLists(), { wrapper });
    await act(async () => {
      result.current.mutate({ familyId: 'f1', ids: ['c', 'a', 'b'] });
    });
    expect(mocked.reorderLists).toHaveBeenCalledWith('f1', ['c', 'a', 'b']);
    const cached = client.getQueryData<List[]>(qk.lists('f1'))!;
    expect(ids(cached)).toEqual(['in', 'c', 'a', 'b']);
    expect(Object.fromEntries(cached.map((l) => [l.id, l.sort_order]))).toEqual({
      in: 5,
      c: 1,
      a: 2,
      b: 3,
    });
    await act(async () => pending.resolve());
  });

  it('mirrors the rpc: skips unknown and inbox ids, keeps the first duplicate, appends missing lists', async () => {
    client.setQueryData(qk.lists('f1'), [
      mk_('in', { kind: 'inbox', sort_order: 0 }),
      mk_('a', { sort_order: 1, created_at: T(1) }),
      mk_('b', { sort_order: 0, created_at: T(2) }),
      mk_('c', { sort_order: 0, created_at: T(1) }),
      mk_('d', { sort_order: 2, created_at: T(1) }),
    ]);
    const pending = deferred();
    mocked.reorderLists.mockReturnValue(pending.promise);
    const { result } = await renderHook(() => useReorderLists(), { wrapper });
    await act(async () => {
      result.current.mutate({ familyId: 'f1', ids: ['gone', 'd', 'in', 'a', 'd'] });
    });
    const cached = client.getQueryData<List[]>(qk.lists('f1'))!;
    // d, a 순서 다음 빠진 c(0, T1), b(0, T2)가 (sort_order, created_at) 순으로 붙는다.
    expect(ids(cached)).toEqual(['in', 'd', 'a', 'c', 'b']);
    expect(Object.fromEntries(cached.map((l) => [l.id, l.sort_order]))).toEqual({
      in: 0,
      d: 1,
      a: 2,
      c: 3,
      b: 4,
    });
    await act(async () => pending.resolve());
  });

  it('rolls back and toasts when the api rejects', async () => {
    const original = family();
    client.setQueryData(qk.lists('f1'), original);
    mocked.reorderLists.mockRejectedValue(new Error('boom'));
    const { result } = await renderHook(() => useReorderLists(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ familyId: 'f1', ids: ['c', 'b', 'a'] }).catch(() => {});
    });
    expect(client.getQueryData(qk.lists('f1'))).toEqual(original);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('optimistic order survives a refetch while the queue is busy', async () => {
    const server = family();
    mocked.fetchLists.mockImplementation(async () => server.map((l) => ({ ...l })));
    client.setQueryData(qk.lists('f1'), family());
    // 앞서 쌓인 이름 바꾸기가 먼저 끝나고, 그 뒤 순서 저장이 아직 큐에 남아 있는 상태.
    const rename = deferred();
    const reorder = deferred();
    mocked.renameList.mockReturnValue(rename.promise);
    mocked.reorderLists.mockReturnValue(reorder.promise);
    const { result } = await renderHook(
      () => ({ lists: useLists('f1'), rename: useRenameList(), reorder: useReorderLists() }),
      { wrapper }
    );
    await act(async () => {
      result.current.rename.mutate({ id: 'a', familyId: 'f1', name: '이마트' });
      result.current.reorder.mutate({ familyId: 'f1', ids: ['c', 'b', 'a'] });
    });
    expect(ids(client.getQueryData(qk.lists('f1')))).toEqual(['in', 'c', 'b', 'a']);

    // 큐가 바쁜 동안: 앞 mutation의 settle, Realtime UPDATE(서버의 옛 순서), 화면의 재조회.
    await act(async () => rename.resolve());
    applyChange(client, 'lists', {
      eventType: 'UPDATE',
      new: { ...server[1], sort_order: 1 },
      old: { id: 'a' },
      schema: 'public',
    } as any);
    expect(ids(client.getQueryData(qk.lists('f1')))).toEqual(['in', 'c', 'b', 'a']);
    expect(client.getQueryState(qk.lists('f1'))?.isInvalidated).toBe(false);

    // 큐가 비면 서버 값(이제 새 순서)으로 맞춰도 순서가 같다.
    server[3].sort_order = 1;
    server[2].sort_order = 2;
    server[1].sort_order = 3;
    await act(async () => reorder.resolve());
    await act(async () => {
      await client.refetchQueries({ queryKey: qk.lists('f1') });
    });
    expect(mocked.fetchLists).toHaveBeenCalled();
    expect(ids(client.getQueryData(qk.lists('f1')))).toEqual(['in', 'c', 'b', 'a']);
  });
});
