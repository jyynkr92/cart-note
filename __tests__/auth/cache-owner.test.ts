import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { reconcileCacheOwner } from '@/src/auth/signed-out-state';
import { resetGeofencing } from '@/src/geofence/sync-geofences';
import { clearCurrentGroup } from '@/src/groups/current-group-store';
import { clearUserCache, syncCacheOwner } from '@/src/lib/query-client';
import { toast } from '@/src/lib/toast';
import { resetOwnerFallbackNoticeForTests } from '@/src/auth/signed-out-state';
import { clearOnboarded } from '@/src/onboarding/onboarded-flag';
import { isSessionOpen, openSession, resetSessionGateForTests } from '@/src/lib/session-gate';

jest.mock('@/src/lib/toast', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/src/lib/supabase', () => ({ AUTH_STORAGE_KEY: 'test-auth', supabase: {} }));
jest.mock('@/src/lib/query-client', () => ({
  syncCacheOwner: jest.fn().mockResolvedValue(undefined),
  clearUserCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/src/geofence/sync-geofences', () => ({
  resetGeofencing: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/src/groups/current-group-store', () => ({
  clearCurrentGroup: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/src/onboarding/onboarded-flag', () => ({
  clearOnboarded: jest.fn().mockResolvedValue(undefined),
}));

let client: QueryClient;
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetSessionGateForTests();
  (syncCacheOwner as jest.Mock).mockReset().mockResolvedValue(undefined);
  (clearUserCache as jest.Mock).mockReset().mockResolvedValue(undefined);
  resetOwnerFallbackNoticeForTests();
  client = new QueryClient();
  jest.spyOn(client, 'resumePausedMutations').mockResolvedValue(undefined);
});
afterEach(() => client.clear());

it('clears per-user device state when the restored session has no user (R3)', async () => {
  await reconcileCacheOwner(client, null);
  expect(syncCacheOwner).toHaveBeenCalledWith(client, null);
  expect(resetGeofencing).toHaveBeenCalledTimes(1);
  expect(clearCurrentGroup).toHaveBeenCalledTimes(1);
  expect(clearOnboarded).toHaveBeenCalledTimes(1);
});

it('keeps device state for a signed-in user and resumes the queue after the owner check', async () => {
  await reconcileCacheOwner(client, 'u1');
  expect(syncCacheOwner).toHaveBeenCalledWith(client, 'u1');
  expect(resetGeofencing).not.toHaveBeenCalled();
  expect(clearCurrentGroup).not.toHaveBeenCalled();
  expect((syncCacheOwner as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
    (client.resumePausedMutations as jest.Mock).mock.invocationCallOrder[0]
  );
});

it('never throws', async () => {
  (syncCacheOwner as jest.Mock).mockRejectedValue(new Error('storage'));
  (resetGeofencing as jest.Mock).mockRejectedValueOnce(new Error('native'));
  await expect(reconcileCacheOwner(client, null)).resolves.toBeUndefined();
  expect(client.resumePausedMutations).not.toHaveBeenCalled();
  expect(clearCurrentGroup).toHaveBeenCalledTimes(1);
});

// B1: 오프라인 콜드 스타트에서 access token 갱신이 실패하면 INITIAL_SESSION이 null로 오지만
// 저장된 세션(refresh token)은 남아 있다. 이것은 로그아웃이 아니다.
describe('null session with a stored refresh token (B1)', () => {
  const storeSession = (over: Record<string, unknown> = {}) =>
    AsyncStorage.setItem(
      'test-auth',
      JSON.stringify({ access_token: 'expired', refresh_token: 'r1', user: { id: '6f1c2a9e-1b2c-4d3e-8f40-0a1b2c3d4e5f' }, ...over })
    );

  it('keeps the cache, queue and device state and does not resume', async () => {
    await storeSession();
    await reconcileCacheOwner(client, null);
    expect(syncCacheOwner).not.toHaveBeenCalled();
    expect(resetGeofencing).not.toHaveBeenCalled();
    expect(clearCurrentGroup).not.toHaveBeenCalled();
    expect(clearOnboarded).not.toHaveBeenCalled();
    expect(client.resumePausedMutations).not.toHaveBeenCalled();
  });

  it('resumes once the same user signs in again', async () => {
    await storeSession();
    await reconcileCacheOwner(client, null);
    await reconcileCacheOwner(client, 'u1');
    expect(syncCacheOwner).toHaveBeenCalledTimes(1);
    expect(syncCacheOwner).toHaveBeenCalledWith(client, 'u1');
    expect(client.resumePausedMutations).toHaveBeenCalledTimes(1);
    expect(clearOnboarded).not.toHaveBeenCalled();
  });

  it('still clears everything when the stored session has no refresh token', async () => {
    await storeSession({ refresh_token: '' });
    await reconcileCacheOwner(client, null);
    expect(syncCacheOwner).toHaveBeenCalledWith(client, null);
    expect(clearOnboarded).toHaveBeenCalledTimes(1);
  });
});

describe('session gate (F2)', () => {
  it('opens the gate only after the owner check for a signed-in user', async () => {
    let openAtSync: boolean | null = null;
    (syncCacheOwner as jest.Mock).mockImplementationOnce(async () => {
      openAtSync = isSessionOpen();
    });
    await reconcileCacheOwner(client, 'u1');
    expect(openAtSync).toBe(false);
    expect(isSessionOpen()).toBe(true);
  });

  it('closes the gate with no session, including offline-user mode', async () => {
    openSession('u1');
    await AsyncStorage.setItem(
      'test-auth',
      JSON.stringify({ refresh_token: 'r1', user: { id: '00000000-0000-4000-8000-000000000001' } })
    );
    await reconcileCacheOwner(client, null);
    expect(isSessionOpen()).toBe(false);
  });

  it('retries the owner check and opens the gate when a retry succeeds (I-1)', async () => {
    (syncCacheOwner as jest.Mock)
      .mockRejectedValueOnce(new Error('storage'))
      .mockResolvedValueOnce(undefined);
    await reconcileCacheOwner(client, 'u1');
    expect(syncCacheOwner).toHaveBeenCalledTimes(2);
    expect(clearUserCache).not.toHaveBeenCalled();
    expect(isSessionOpen()).toBe(true);
    expect(client.resumePausedMutations).toHaveBeenCalledTimes(1);
  });

  it('after 3 failed owner checks, wipes the (possibly foreign) cache and opens the gate (I-1)', async () => {
    (syncCacheOwner as jest.Mock).mockRejectedValue(new Error('storage'));
    let openWhenCleared: boolean | null = null;
    (clearUserCache as jest.Mock).mockImplementationOnce(async () => {
      openWhenCleared = isSessionOpen();
    });
    await reconcileCacheOwner(client, 'u1');
    expect(syncCacheOwner).toHaveBeenCalledTimes(3);
    expect(clearUserCache).toHaveBeenCalledWith(client);
    expect(openWhenCleared).toBe(false); // 지운 뒤에만 연다
    expect(isSessionOpen()).toBe(true);
  });

  it('a stale run never opens the gate after a newer run (M-1)', async () => {
    let release!: () => void;
    (syncCacheOwner as jest.Mock).mockImplementationOnce(
      () => new Promise<void>((r) => (release = r))
    );
    const first = reconcileCacheOwner(client, 'u1');
    await reconcileCacheOwner(client, null); // 그 사이 로그아웃
    release();
    await first;
    expect(isSessionOpen()).toBe(false);
    expect(client.resumePausedMutations).not.toHaveBeenCalled();
  });
});

describe('owner unknown fallback notice (N-1)', () => {
  it('tells the user once when queued changes were discarded', async () => {
    (syncCacheOwner as jest.Mock).mockRejectedValue(new Error('io'));
    client.getMutationCache().build(client, { mutationKey: ['m', 'items', 'delete'] });
    await reconcileCacheOwner(client, 'u1');
    expect(toast.error).toHaveBeenCalledWith('보내지 못한 변경을 지웠어요');
    await reconcileCacheOwner(client, 'u1');
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when nothing was queued', async () => {
    (syncCacheOwner as jest.Mock).mockRejectedValue(new Error('io'));
    await reconcileCacheOwner(client, 'u1');
    expect(toast.error).not.toHaveBeenCalled();
  });
});
