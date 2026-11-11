import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { NearbyAlertToggle } from '@/src/geofence/NearbyAlertToggle';
import { getEnabled, setEnabled } from '@/src/geofence/geofence-store';
import { requestNearbyAlertPermissions } from '@/src/geofence/permissions';
import { syncGeofences } from '@/src/geofence/sync-geofences';

jest.mock('@/src/geofence/permissions', () => ({ requestNearbyAlertPermissions: jest.fn() }));
jest.mock('@/src/geofence/sync-geofences', () => ({
  syncGeofences: jest.fn().mockResolvedValue(undefined),
}));

const request = requestNearbyAlertPermissions as jest.Mock;
const sync = syncGeofences as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});
afterEach(async () => {
  await cleanup();
});

const toggle = () => screen.findByRole('checkbox', { name: '근처 마트 알림' });

it('turns on after permissions are granted and syncs', async () => {
  request.mockResolvedValue('granted');
  await render(<NearbyAlertToggle />);
  expect(await toggle()).not.toBeChecked();
  await fireEvent.press(await toggle());
  await waitFor(() => expect(sync).toHaveBeenCalled());
  expect(request).toHaveBeenCalled();
  expect(await getEnabled()).toBe(true);
  expect(await toggle()).toBeChecked();
});

it('stays off when denied and offers the system settings', async () => {
  request.mockResolvedValue('denied');
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await render(<NearbyAlertToggle />);
  await fireEvent.press(await toggle());
  expect(await screen.findByText('위치 권한이 필요해요')).toBeTruthy();
  expect(await toggle()).not.toBeChecked();
  expect(await getEnabled()).toBe(false);
  expect(sync).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('설정 열기'));
  expect(open).toHaveBeenCalled();
  open.mockRestore();
});

it('turns off without asking for permissions and syncs (stops geofencing)', async () => {
  await setEnabled(true);
  await render(<NearbyAlertToggle />);
  await waitFor(async () => expect(await toggle()).toBeChecked());
  await fireEvent.press(await toggle());
  await waitFor(() => expect(sync).toHaveBeenCalled());
  expect(request).not.toHaveBeenCalled();
  expect(await getEnabled()).toBe(false);
  expect(await toggle()).not.toBeChecked();
});
