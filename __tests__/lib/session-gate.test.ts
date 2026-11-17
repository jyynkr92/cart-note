import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import * as itemApi from '@/src/items/item-api';
import type { Item } from '@/src/items/item-api';
import { useDeleteItems } from '@/src/items/use-items';
import { createQueryClient, persistOptions } from '@/src/lib/query-client';
import { qk } from '@/src/lib/query-keys';
import {
  closeSession,
  installSessionCheck,
  openSession,
  resetSessionGateForTests,
  sessionRestored,
  setNetworkOnline,
} from '@/src/lib/session-gate';
import { toast } from '@/src/lib/toast';
import { disposeClient } from '@/test-utils/dispose-client';

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

const item = (id: string): Item => ({
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
});

let client: ReturnType<typeof createQueryClient>;
let session: boolean;
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetSessionGateForTests();
  onlineManager.setOnline(true);
  session = false;
  installSessionCheck(async () => session);
  for (const fn of Object.values(api))
    if (jest.isMockFunction(fn)) fn.mockResolvedValue(undefined as never);
  client = createQueryClient();
  client.setQueryData(qk.items('l1'), [item('a'), item('b')]);
});
afterEach(async () => {
  await cleanup();
  disposeClient(client);
  resetSessionGateForTests();
  onlineManager.setOnline(true);
});

async function deleteA() {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  const del = await renderHook(() => useDeleteItems(), { wrapper });
  await act(async () => {
    del.result.current.mutate({ listId: 'l1', ids: ['a'] });
  });
}
const mutation = () => client.getMutationCache().getAll()[0];
const ids = () => client.getQueryData<Item[]>(qk.items('l1'))!.map((i) => i.id);
const persisted = () => persistOptions.dehydrateOptions!.shouldDehydrateMutation!(mutation());

describe('offline queue without a session (F2)', () => {
  it('stays paused when the network returns in offline-user mode (no session)', async () => {
    closeSession();
    setNetworkOnline(false);
    await deleteA();
    await waitFor(() => expect(mutation().state.isPaused).toBe(true));

    // 네트워크 복귀: QueryClient가 resumePausedMutations를 부르지만 세션이 없으니 아무 요청도 나가면 안 된다.
    await act(async () => setNetworkOnline(true));
    await act(async () => {
      await Promise.race([client.resumePausedMutations(), new Promise((r) => setTimeout(r, 20))]);
    });
    expect(api.deleteItems).not.toHaveBeenCalled();
    expect(mutation().state.isPaused).toBe(true);
    expect(persisted()).toBe(true);
    expect(ids()).toEqual(['b']);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('pauses instead of sending or rolling back when getSession has no session', async () => {
    openSession('u1');
    setNetworkOnline(true);
    await deleteA();
    await waitFor(() => expect(mutation().state.isPaused).toBe(true));
    expect(api.deleteItems).not.toHaveBeenCalled();
    expect(mutation().state.status).toBe('pending');
    expect(persisted()).toBe(true);
    expect(ids()).toEqual(['b']);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('replays exactly once when the session comes back for the same user', async () => {
    openSession('u1');
    setNetworkOnline(true);
    await deleteA();
    await waitFor(() => expect(mutation().state.isPaused).toBe(true));

    session = true;
    await act(async () => sessionRestored('u1'));
    await waitFor(() => expect(mutation().state.status).toBe('success'));
    await act(async () => {
      await client.resumePausedMutations();
    });
    expect(api.deleteItems).toHaveBeenCalledTimes(1);
    expect(api.deleteItems).toHaveBeenCalledWith(['a']);
  });

  it("does not reopen for a different user's session", async () => {
    openSession('u1');
    setNetworkOnline(true);
    await deleteA();
    await waitFor(() => expect(mutation().state.isPaused).toBe(true));
    session = true;
    await act(async () => sessionRestored('u2'));
    await act(async () => {
      await Promise.race([client.resumePausedMutations(), new Promise((r) => setTimeout(r, 20))]);
    });
    expect(api.deleteItems).not.toHaveBeenCalled();
    expect(mutation().state.isPaused).toBe(true);
  });
});
