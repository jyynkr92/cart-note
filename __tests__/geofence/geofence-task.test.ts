import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { fetchOpenCount } from '@/src/geofence/geofence-api';
import { setGroupCount, setRegionMeta } from '@/src/geofence/geofence-store';
import { GEOFENCE_TASK, onGeofenceEvent } from '@/src/geofence/geofence-task';
import { requestNearbyAlertPermissions } from '@/src/geofence/permissions';
import { supabase } from '@/src/lib/supabase';
import * as Location from 'expo-location';

jest.mock('@/src/lib/supabase', () => ({ supabase: { auth: { getSession: jest.fn() } } }));
jest.mock('@/src/geofence/geofence-api', () => ({ fetchOpenCount: jest.fn() }));

const getSession = supabase.auth.getSession as jest.Mock;
const schedule = Notifications.scheduleNotificationAsync as jest.Mock;
const body = (eventType: number, identifier = 'r1', error: unknown = null) =>
  ({ data: { eventType, region: { identifier } }, error, executionInfo: {} }) as never;

// 모듈 최상위 정의 호출을 clearAllMocks 전에 확인한다.
it('defines the background task at module load', () => {
  expect(TaskManager.defineTask).toHaveBeenCalledWith(GEOFENCE_TASK, onGeofenceEvent);
  expect(GEOFENCE_TASK).toBe('cart-note-geofence');
});

describe('onGeofenceEvent', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await setRegionMeta({ r1: { listId: 'L1', familyId: 'F1', groupName: '우리집', placeName: '이마트' } });
    await setGroupCount(1);
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    (fetchOpenCount as jest.Mock).mockResolvedValue(2);
  });

  it('schedules a local notification on Enter', async () => {
    await onGeofenceEvent(body(Location.GeofencingEventType.Enter));
    expect(schedule).toHaveBeenCalledWith({
      content: { title: '이마트 근처예요 · 사야 할 것 2개', data: { listId: 'L1', familyId: 'F1' } },
      trigger: null,
    });
  });

  it('ignores Exit and errors', async () => {
    await onGeofenceEvent(body(Location.GeofencingEventType.Exit));
    await onGeofenceEvent(body(Location.GeofencingEventType.Enter, 'r1', new Error('x')));
    expect(schedule).not.toHaveBeenCalled();
  });

  it('does not notify when signed out', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await onGeofenceEvent(body(Location.GeofencingEventType.Enter));
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe('requestNearbyAlertPermissions', () => {
  const N = Notifications as jest.Mocked<typeof Notifications>;
  const L = Location as jest.Mocked<typeof Location>;
  beforeEach(() => {
    jest.clearAllMocks();
    N.requestPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    L.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    L.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
  });

  it('asks notifications, then foreground, then background', async () => {
    await expect(requestNearbyAlertPermissions()).resolves.toBe('granted');
    const order = [
      N.requestPermissionsAsync.mock.invocationCallOrder[0],
      L.requestForegroundPermissionsAsync.mock.invocationCallOrder[0],
      L.requestBackgroundPermissionsAsync.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('stops at the first denial', async () => {
    L.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
    await expect(requestNearbyAlertPermissions()).resolves.toBe('denied');
    expect(L.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('treats a throwing request as denied', async () => {
    N.requestPermissionsAsync.mockRejectedValue(new Error('native'));
    await expect(requestNearbyAlertPermissions()).resolves.toBe('denied');
  });
});
