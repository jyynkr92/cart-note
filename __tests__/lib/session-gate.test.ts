import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider, onlineManager, dehydrate } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import * as itemApi from '@/src/items/item-api';
import type { Item } from '@/src/items/item-api';
import { useDeleteItems } from '@/src/items/use-items';
import { createQueryClient, persistOptions } from '@/src/lib/query-client';
import { qk } from '@/src/lib/query-keys';
import {
  closeSession,
  getReprobeAttemptForTests,
  getVerifiedUserId,
  hasLiveSession,
  installReachabilityProbe,
  markBackendUnreachable,
  markSessionUnavailable,
  reprobeNow,
  installSessionCheck,
  isSessionOpen,
  openSession,
  resetSessionGateForTests,
  sessionRestored,
  setNetworkOnline,
} from '@/src/lib/session-gate';
import { toast } from '@/src/lib/toast';
import { RetryableNetworkError } from '@/src/lib/queue-retry';
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
let sessionUser = 'u1';
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetSessionGateForTests();
  onlineManager.setOnline(true);
  session = false;
  sessionUser = 'u1';
  installSessionCheck(async () => (session ? sessionUser : null));
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

describe('network failure mid-mutation (F7)', () => {
  it('pauses and later replays the whole mutation instead of rolling back', async () => {
    openSession('u1');
    setNetworkOnline(true);
    session = true;
    api.deleteItems.mockImplementationOnce(async () => {
      // 요청 도중 연결이 끊겼다(NetInfo가 뒤이어 오프라인을 알린다).
      setNetworkOnline(false);
      throw new RetryableNetworkError(new TypeError('Network request failed'));
    });
    await deleteA();
    await waitFor(() => expect(mutation().state.isPaused).toBe(true));
    expect(mutation().state.status).toBe('pending');
    expect(persisted()).toBe(true);
    expect(ids()).toEqual(['b']); // 롤백하지 않는다
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => setNetworkOnline(true));
    await waitFor(() => expect(mutation().state.status).toBe('success'));
    expect(api.deleteItems).toHaveBeenCalledTimes(2);
    expect(api.deleteItems).toHaveBeenLastCalledWith(['a']);
  });

  it('still fails and rolls back on a non-network error', async () => {
    openSession('u1');
    setNetworkOnline(true);
    session = true;
    api.deleteItems.mockRejectedValueOnce({ code: '42501' });
    await deleteA();
    await waitFor(() => expect(mutation().state.status).toBe('error'));
    expect(ids()).toEqual(['a', 'b']);
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('session must belong to the verified user (M-1)', () => {
  it("does not send when getSession returns a different user's session", async () => {
    openSession('u1');
    setNetworkOnline(true);
    session = true;
    sessionUser = 'u2';
    await deleteA();
    await waitFor(() => expect(mutation().state.isPaused).toBe(true));
    expect(api.deleteItems).not.toHaveBeenCalled();
    expect(isSessionOpen()).toBe(false);
  });

  it("closes the gate when a different user's session arrives", async () => {
    openSession('u1');
    setNetworkOnline(true);
    expect(onlineManager.isOnline()).toBe(true);
    sessionRestored('u2');
    expect(isSessionOpen()).toBe(false);
    expect(onlineManager.isOnline()).toBe(false);
  });
});

describe('fail-closed default (M-2)', () => {
  it('has no session until a real check is installed', async () => {
    resetSessionGateForTests();
    await expect(hasLiveSession()).resolves.toBe(false);
  });

  it('the root layout installs the live getSession check', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src: string = require('fs').readFileSync(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('path').join(process.cwd(), 'app/_layout.tsx'),
      'utf8'
    );
    expect(src).toMatch(/installSessionCheck\(liveSessionCheck\)/);
  });
});

describe('backend unreachable while NetInfo says online (I-2)', () => {
  it('pauses (persisted) instead of retrying forever, and replays after a successful probe', async () => {
    openSession('u1');
    setNetworkOnline(true);
    session = true;
    installReachabilityProbe(async () => false);
    api.deleteItems.mockRejectedValueOnce(
      new RetryableNetworkError(new TypeError('Network request failed'))
    );
    await deleteA();
    await waitFor(() => expect(mutation().state.isPaused).toBe(true));
    expect(onlineManager.isOnline()).toBe(false);
    const state = dehydrate(client, {
      shouldDehydrateMutation: persistOptions.dehydrateOptions!.shouldDehydrateMutation,
    });
    expect(state.mutations).toHaveLength(1);
    expect(ids()).toEqual(['b']);
    expect(toast.error).not.toHaveBeenCalled();

    installReachabilityProbe(async () => true);
    await act(async () => reprobeNow());
    await waitFor(() => expect(mutation().state.status).toBe('success'));
    expect(api.deleteItems).toHaveBeenCalledTimes(2);
  });
});

describe('re-probe schedule (I-2, M-3)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('re-probes reachability with backoff (5s, 10s, 20s…) until it succeeds', async () => {
    const probe = jest.fn(async () => false);
    installReachabilityProbe(probe);
    openSession('u1');
    setNetworkOnline(true);
    markBackendUnreachable();
    expect(onlineManager.isOnline()).toBe(false);
    await jest.advanceTimersByTimeAsync(4999);
    expect(probe).toHaveBeenCalledTimes(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(probe).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(probe).toHaveBeenCalledTimes(2);
    probe.mockResolvedValue(true);
    await jest.advanceTimersByTimeAsync(20_000);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(onlineManager.isOnline()).toBe(true);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(probe).toHaveBeenCalledTimes(3); // 건강해지면 멈춘다
  });

  it('re-probes immediately when NetInfo regains the network', async () => {
    const probe = jest.fn(async () => true);
    installReachabilityProbe(probe);
    openSession('u1');
    setNetworkOnline(true);
    markBackendUnreachable();
    setNetworkOnline(false);
    await act(async () => setNetworkOnline(true));
    expect(probe).toHaveBeenCalledTimes(1);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('re-probes the session after markSessionUnavailable and reopens for the same user (M-3)', async () => {
    openSession('u1');
    setNetworkOnline(true);
    session = false;
    markSessionUnavailable();
    expect(onlineManager.isOnline()).toBe(false);
    await jest.advanceTimersByTimeAsync(5000);
    expect(onlineManager.isOnline()).toBe(false);
    session = true;
    await jest.advanceTimersByTimeAsync(10_000);
    expect(isSessionOpen()).toBe(true);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('does not keep probing after sign-out', async () => {
    const probe = jest.fn(async () => false);
    installReachabilityProbe(probe);
    openSession('u1');
    setNetworkOnline(true);
    markSessionUnavailable();
    closeSession();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('probe loop lifecycle (N-2)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sign-out stops the probe loop even while the backend is unreachable', async () => {
    const probe = jest.fn(async () => false);
    installReachabilityProbe(probe);
    openSession('u1');
    setNetworkOnline(true);
    markBackendUnreachable();
    closeSession();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(probe).not.toHaveBeenCalled();
  });

  it('signing in while unreachable probes right away with a fresh backoff', async () => {
    const probe = jest.fn(async () => false);
    installReachabilityProbe(probe);
    openSession('u1');
    setNetworkOnline(true);
    markBackendUnreachable();
    await jest.advanceTimersByTimeAsync(5_000); // attempt 1 → 다음은 10초
    closeSession();
    probe.mockClear();
    probe.mockResolvedValue(true);
    openSession('u2');
    await jest.advanceTimersByTimeAsync(0);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(onlineManager.isOnline()).toBe(true);
    expect(getReprobeAttemptForTests()).toBe(0);
  });
});

describe('backoff resets only on a real request success (N-4)', () => {
  it('grows while the health probe succeeds but writes keep failing', async () => {
    jest.useFakeTimers();
    try {
      const probe = jest.fn(async () => true);
      installReachabilityProbe(probe);
      openSession('u1');
      setNetworkOnline(true);
      markBackendUnreachable();
      await jest.advanceTimersByTimeAsync(5_000);
      expect(probe).toHaveBeenCalledTimes(1);
      expect(onlineManager.isOnline()).toBe(true);
      // 다시 쓰기가 연결 오류로 실패한다 → 이번에는 10초 뒤에 확인한다.
      markBackendUnreachable();
      await jest.advanceTimersByTimeAsync(9_999);
      expect(probe).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(probe).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a successful queued request resets the backoff', async () => {
    installReachabilityProbe(async () => true);
    openSession('u1');
    setNetworkOnline(true);
    session = true;
    markBackendUnreachable();
    await act(async () => reprobeNow());
    markBackendUnreachable();
    await act(async () => reprobeNow());
    expect(getReprobeAttemptForTests()).toBe(2);
    await deleteA();
    await waitFor(() => expect(mutation().state.status).toBe('success'));
    expect(getReprobeAttemptForTests()).toBe(0);
  });
});

describe('verified user check for jest (N-3)', () => {
  it('a check that returns the verified user only passes while the gate is open for them', async () => {
    installSessionCheck(async () => getVerifiedUserId());
    await expect(hasLiveSession()).resolves.toBe(false);
    openSession('u1');
    expect(getVerifiedUserId()).toBe('u1');
    await expect(hasLiveSession()).resolves.toBe(true);
    closeSession();
    await expect(hasLiveSession()).resolves.toBe(false);
  });
});
