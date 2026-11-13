import { QueryClient } from '@tanstack/react-query';
import { reconcileCacheOwner } from '@/src/auth/signed-out-state';
import { resetGeofencing } from '@/src/geofence/sync-geofences';
import { clearCurrentGroup } from '@/src/groups/current-group-store';
import { syncCacheOwner } from '@/src/lib/query-client';
import { clearOnboarded } from '@/src/onboarding/onboarded-flag';

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
beforeEach(() => {
  jest.clearAllMocks();
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
