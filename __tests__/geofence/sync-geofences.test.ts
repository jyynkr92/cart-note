import AsyncStorage from '@react-native-async-storage/async-storage';
import { waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { fetchOpenCounts } from '@/src/geofence/geofence-api';
import {
  getCachedOpenCount,
  getEnabled,
  getGroupCount,
  getLastNotified,
  getRegionMeta,
  markNotified,
  setEnabled,
  setOpenCounts,
  setRegionMeta,
} from '@/src/geofence/geofence-store';
import { GEOFENCE_TASK } from '@/src/geofence/geofence-task';
import { resetGeofencing, syncGeofences } from '@/src/geofence/sync-geofences';
import { fetchMyFamilies } from '@/src/groups/group-api';
import { fetchAllMyLocations, type MyLocation } from '@/src/locations/location-api';

jest.mock('@/src/lib/supabase', () => ({ supabase: { auth: { getSession: jest.fn() } } }));
jest.mock('@/src/locations/location-api', () => ({ fetchAllMyLocations: jest.fn() }));
jest.mock('@/src/groups/group-api', () => ({ fetchMyFamilies: jest.fn() }));
jest.mock('@/src/geofence/geofence-api', () => ({
  fetchOpenCount: jest.fn(),
  fetchOpenCounts: jest.fn(),
}));

const L = Location as jest.Mocked<typeof Location>;
const locations = fetchAllMyLocations as jest.Mock;
const families = fetchMyFamilies as jest.Mock;
const openCounts = fetchOpenCounts as jest.Mock;

const loc = (i: number, over: Partial<MyLocation> = {}): MyLocation => ({
  id: `r${i}`,
  list_id: `L${i}`,
  family_id: 'F1',
  place_name: `마트${i}`,
  address: null,
  kakao_place_id: `k${i}`,
  lat: 37.5 + i * 0.01,
  lng: 127,
  radius_m: 300,
  list_name: '장보기',
  family_name: '우리집',
  ...over,
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  L.hasStartedGeofencingAsync.mockResolvedValue(false);
  L.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
  L.getLastKnownPositionAsync.mockResolvedValue(null);
  L.getCurrentPositionAsync.mockResolvedValue(null as never);
  L.startGeofencingAsync.mockResolvedValue(undefined);
  locations.mockResolvedValue([loc(0)]);
  families.mockResolvedValue([{ id: 'F1' }, { id: 'F2' }]);
  openCounts.mockResolvedValue({ L0: 3 });
});

it('stops a registered geofence when disabled', async () => {
  L.hasStartedGeofencingAsync.mockResolvedValue(true);
  await syncGeofences();
  expect(L.stopGeofencingAsync).toHaveBeenCalledWith(GEOFENCE_TASK);
  expect(L.startGeofencingAsync).not.toHaveBeenCalled();
  expect(locations).not.toHaveBeenCalled();
});

it('does not call stop when disabled and nothing is registered', async () => {
  await syncGeofences();
  expect(L.stopGeofencingAsync).not.toHaveBeenCalled();
});

it('registers the 20 nearest regions and saves metadata, group count and open counts', async () => {
  await setEnabled(true);
  locations.mockResolvedValue(Array.from({ length: 25 }, (_, i) => loc(i, { radius_m: i === 0 ? 150 : 300 })));
  L.getLastKnownPositionAsync.mockResolvedValue({
    coords: { latitude: 37.5, longitude: 127 },
  } as never);
  await syncGeofences();

  expect(L.getCurrentPositionAsync).not.toHaveBeenCalled();
  const [task, regions] = L.startGeofencingAsync.mock.calls[0];
  expect(task).toBe(GEOFENCE_TASK);
  expect(regions).toHaveLength(20);
  expect(regions![0]).toEqual({
    identifier: 'r0',
    latitude: 37.5,
    longitude: 127,
    radius: 150,
    notifyOnEnter: true,
    notifyOnExit: false,
  });
  expect(regions!.map((r) => r.identifier)).not.toContain('r24');
  const meta = await getRegionMeta();
  expect(Object.keys(meta)).toHaveLength(20);
  expect(meta.r1).toEqual({ listId: 'L1', familyId: 'F1', groupName: '우리집', placeName: '마트1' });
  expect(await getGroupCount()).toBe(2);
  expect(openCounts).toHaveBeenCalledWith(expect.arrayContaining(['L0', 'L19']));
  expect(await getCachedOpenCount('L0')).toBe(3);
});

it('uses the given locations instead of fetching', async () => {
  await setEnabled(true);
  await syncGeofences({ locations: [loc(7)] });
  expect(locations).not.toHaveBeenCalled();
  expect(L.startGeofencingAsync.mock.calls[0][1]![0].identifier).toBe('r7');
});

it('defaults the radius to 300 when missing', async () => {
  await setEnabled(true);
  await syncGeofences({ locations: [loc(1, { radius_m: null as unknown as number })] });
  expect(L.startGeofencingAsync.mock.calls[0][1]![0].radius).toBe(300);
});

it('stops instead of starting with an empty list', async () => {
  await setEnabled(true);
  await setRegionMeta({ old: { listId: 'x', familyId: 'y', groupName: 'g', placeName: 'p' } });
  L.hasStartedGeofencingAsync.mockResolvedValue(true);
  locations.mockResolvedValue([]);
  await syncGeofences();
  expect(L.startGeofencingAsync).not.toHaveBeenCalled();
  expect(L.stopGeofencingAsync).toHaveBeenCalledWith(GEOFENCE_TASK);
  expect(await getRegionMeta()).toEqual({});
});

it('turns itself off quietly when background permission was revoked', async () => {
  await setEnabled(true);
  L.hasStartedGeofencingAsync.mockResolvedValue(true);
  L.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
  await expect(syncGeofences()).resolves.toBeUndefined();
  expect(await getEnabled()).toBe(false);
  expect(L.startGeofencingAsync).not.toHaveBeenCalled();
  expect(L.stopGeofencingAsync).toHaveBeenCalled();
});

it('never throws when native calls fail', async () => {
  await setEnabled(true);
  L.hasStartedGeofencingAsync.mockRejectedValue(new Error('native'));
  L.getLastKnownPositionAsync.mockRejectedValue(new Error('native'));
  L.getCurrentPositionAsync.mockRejectedValue(new Error('native'));
  L.startGeofencingAsync.mockRejectedValue(new Error('native'));
  openCounts.mockRejectedValue(new Error('offline'));
  await expect(syncGeofences()).resolves.toBeUndefined();
});

it('keeps the current regions when the locations fetch fails', async () => {
  await setEnabled(true);
  const meta = { r9: { listId: 'L9', familyId: 'F1', groupName: 'g', placeName: 'p' } };
  await setRegionMeta(meta);
  locations.mockRejectedValue(new Error('offline'));
  await expect(syncGeofences()).resolves.toBeUndefined();
  expect(L.startGeofencingAsync).not.toHaveBeenCalled();
  expect(L.stopGeofencingAsync).not.toHaveBeenCalled();
  expect(await getRegionMeta()).toEqual(meta);
});

it('falls back to the first regions when the position lookup hangs', async () => {
  jest.useFakeTimers();
  try {
    await setEnabled(true);
    L.getCurrentPositionAsync.mockReturnValue(new Promise(() => {}));
    const done = syncGeofences();
    await jest.advanceTimersByTimeAsync(10_000);
    await done;
    expect(L.startGeofencingAsync).toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

it('does not run concurrently with itself and coalesces calls into one trailing run', async () => {
  await setEnabled(true);
  let release!: (v: MyLocation[]) => void;
  locations.mockReturnValueOnce(new Promise((r) => (release = r)));
  const a = syncGeofences();
  const b = syncGeofences();
  const c = syncGeofences();
  await waitFor(() => expect(locations).toHaveBeenCalled());
  expect(locations).toHaveBeenCalledTimes(1);
  release([loc(0)]);
  await Promise.all([a, b, c]);
  expect(locations).toHaveBeenCalledTimes(2);
  expect(L.startGeofencingAsync).toHaveBeenCalledTimes(2);
});

describe('resetGeofencing (sign-out)', () => {
  it('stops geofencing and clears the per-user data', async () => {
    await setEnabled(true);
    await setRegionMeta({ r1: { listId: 'L1', familyId: 'F1', groupName: 'g', placeName: 'p' } });
    await setOpenCounts({ L1: 2 });
    await markNotified('L1', 1);
    L.hasStartedGeofencingAsync.mockResolvedValue(true);

    await resetGeofencing();

    expect(L.stopGeofencingAsync).toHaveBeenCalledWith(GEOFENCE_TASK);
    expect(await getRegionMeta()).toEqual({});
    expect(await getCachedOpenCount('L1')).toBeNull();
    expect(await getLastNotified()).toEqual({});
  });

  it('prevents a sync already in flight from registering regions afterwards', async () => {
    await setEnabled(true);
    let release!: (v: MyLocation[]) => void;
    locations.mockReturnValueOnce(new Promise((r) => (release = r)));
    const running = syncGeofences();
    await waitFor(() => expect(locations).toHaveBeenCalled());
    await resetGeofencing();
    release([loc(0)]);
    await running;
    expect(L.startGeofencingAsync).not.toHaveBeenCalled();
    expect(await getRegionMeta()).toEqual({});
  });

  it('never throws', async () => {
    L.hasStartedGeofencingAsync.mockRejectedValue(new Error('native'));
    await expect(resetGeofencing()).resolves.toBeUndefined();
  });
});
