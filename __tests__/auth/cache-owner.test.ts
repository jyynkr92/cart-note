import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { reconcileCacheOwner } from '@/src/auth/signed-out-state';
import { resetGeofencing } from '@/src/geofence/sync-geofences';
import { clearCurrentGroup } from '@/src/groups/current-group-store';
import { syncCacheOwner } from '@/src/lib/query-client';
import { clearOnboarded } from '@/src/onboarding/onboarded-flag';
import { isSessionOpen, openSession, resetSessionGateForTests } from '@/src/lib/session-gate';

jest.mock('@/src/lib/supabase', () => ({ AUTH_STORAGE_KEY: 'test-auth', supabase: {} }));
jest.mock('@/src/lib/query-client', () => ({ syncCacheOwner: jest.fn().mockResolvedValue(undefined) }));
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
  (syncCacheOwner as jest.Mock).mockRejectedValueOnce(new Error('storage'));
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
      JSON.stringify({ access_token: 'expired', refresh_token: 'r1', user: { id: 'u1' }, ...over })
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

  it('keeps the gate closed when the owner check fails', async () => {
    (syncCacheOwner as jest.Mock).mockRejectedValueOnce(new Error('storage'));
    await reconcileCacheOwner(client, 'u1');
    expect(isSessionOpen()).toBe(false);
  });
});
