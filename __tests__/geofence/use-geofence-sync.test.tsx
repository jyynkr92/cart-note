import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { getCachedOpenCount } from '@/src/geofence/geofence-store';
import { syncGeofences } from '@/src/geofence/sync-geofences';
import { useGeofenceSync } from '@/src/geofence/use-geofence-sync';
import { qk } from '@/src/lib/query-keys';
import { fetchAllMyLocations } from '@/src/locations/location-api';
import { disposeClient } from '@/test-utils/dispose-client';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@/src/geofence/sync-geofences', () => ({
  syncGeofences: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/src/locations/location-api', () => ({ fetchAllMyLocations: jest.fn() }));

const sync = syncGeofences as jest.Mock;
const locations = fetchAllMyLocations as jest.Mock;

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

let appStateHandler: ((s: string) => void) | undefined;
const removeAppState = jest.fn();

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  locations.mockResolvedValue([{ id: 'r1' }]);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, h) => {
    appStateHandler = h as never;
    return { remove: removeAppState } as never;
  });
});
afterEach(async () => {
  await cleanup();
  disposeClient(client);
  jest.restoreAllMocks();
});

it('does nothing until ready', async () => {
  await renderHook(() => useGeofenceSync(false), { wrapper });
  expect(sync).not.toHaveBeenCalled();
  expect(locations).not.toHaveBeenCalled();
});

it('syncs on start, on foreground, and when locations change; cleans up listeners', async () => {
  const { unmount } = await renderHook(() => useGeofenceSync(true), { wrapper });
  expect(sync).toHaveBeenCalledWith();
  await waitFor(() => expect(sync).toHaveBeenCalledWith({ locations: [{ id: 'r1' }] }));

  sync.mockClear();
  await act(async () => appStateHandler?.('active'));
  expect(sync).toHaveBeenCalledWith();
  sync.mockClear();
  await act(async () => appStateHandler?.('background'));
  expect(sync).not.toHaveBeenCalled();

  locations.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
  await act(async () => {
    await client.invalidateQueries({ queryKey: qk.allLocations() });
  });
  await waitFor(() =>
    expect(sync).toHaveBeenCalledWith({ locations: [{ id: 'r1' }, { id: 'r2' }] })
  );

  await unmount();
  expect(removeAppState).toHaveBeenCalled();
});

it('snapshots open counts from successful lists queries', async () => {
  const { unmount } = await renderHook(() => useGeofenceSync(true), { wrapper });
  await act(async () => {
    await client.fetchQuery({
      queryKey: qk.lists('F1'),
      queryFn: async () => [
        { id: 'L1', unfinished_count: 5 },
        { id: 'L2' },
      ],
    });
  });
  await waitFor(async () => expect(await getCachedOpenCount('L1')).toBe(5));
  expect(await getCachedOpenCount('L2')).toBeNull();
  await unmount();

  await act(async () => {
    await client.fetchQuery({
      queryKey: qk.lists('F2'),
      queryFn: async () => [{ id: 'L3', unfinished_count: 1 }],
    });
  });
  expect(await getCachedOpenCount('L3')).toBeNull();
});
