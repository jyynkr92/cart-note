import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Linking } from 'react-native';
import { NearbyAlertToggle } from '@/src/geofence/NearbyAlertToggle';
import { getEnabled, setEnabled } from '@/src/geofence/geofence-store';
import {
  hasBackgroundLocationPermission,
  requestNearbyAlertPermissions,
} from '@/src/geofence/permissions';
import { syncGeofences } from '@/src/geofence/sync-geofences';

jest.mock('@/src/geofence/permissions', () => ({
  requestNearbyAlertPermissions: jest.fn(),
  hasBackgroundLocationPermission: jest.fn(),
}));
jest.mock('@/src/geofence/sync-geofences', () => ({
  syncGeofences: jest.fn().mockResolvedValue(undefined),
}));

const request = requestNearbyAlertPermissions as jest.Mock;
const sync = syncGeofences as jest.Mock;
const hasPermission = hasBackgroundLocationPermission as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  hasPermission.mockResolvedValue(true);
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

it('exposes a single accessible toggle', async () => {
  await render(<NearbyAlertToggle />);
  await toggle();
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
});

it('is disabled until the saved setting is loaded', async () => {
  // async-storage 목의 getItem은 이미 jest.fn이라 spyOn/mockRestore를 쓰면 구현이 지워진다.
  (AsyncStorage.getItem as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
  await render(<NearbyAlertToggle />);
  expect(await toggle()).toBeDisabled();
});

it('re-reads the setting when the app returns to the foreground and removes the listener', async () => {
  let handler: ((s: string) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementationOnce((_, h) => {
    handler = h as never;
    return { remove } as never;
  });
  await setEnabled(true);
  const { unmount } = await render(<NearbyAlertToggle />);
  await waitFor(async () => expect(await toggle()).toBeChecked());
  await setEnabled(false); // 예: 권한 철회로 동기화가 끈 경우
  await act(async () => handler?.('active'));
  await waitFor(async () => expect(await toggle()).not.toBeChecked());
  await unmount();
  expect(remove).toHaveBeenCalled();
});

it('shows the denied state when permission was revoked while in the background', async () => {
  let handler: ((s: string) => void) | undefined;
  // RN 목의 addEventListener는 이미 jest.fn이라 mockRestore 대신 한 번만 바꾼다.
  jest.spyOn(AppState, 'addEventListener').mockImplementationOnce((_, h) => {
    handler = h as never;
    return { remove: jest.fn() } as never;
  });
  await setEnabled(true);
  await render(<NearbyAlertToggle />);
  await waitFor(async () => expect(await toggle()).toBeChecked());
  expect(screen.queryByText('위치 권한이 필요해요')).toBeNull();
  hasPermission.mockResolvedValue(false); // 시스템 설정에서 위치 권한을 끔
  await act(async () => handler?.('active'));
  expect(await screen.findByText('위치 권한이 필요해요')).toBeTruthy();
  expect(screen.getByText('설정 열기')).toBeTruthy();
});

it('does not warn about permissions when alerts were never turned on', async () => {
  hasPermission.mockResolvedValue(false);
  await render(<NearbyAlertToggle />);
  expect(await toggle()).not.toBeChecked();
  expect(screen.queryByText('위치 권한이 필요해요')).toBeNull();
});
