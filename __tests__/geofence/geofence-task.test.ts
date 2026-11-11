import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { fetchOpenCount } from '@/src/geofence/geofence-api';
import { getLastNotified, setGroupCount, setOpenCounts, setRegionMeta } from '@/src/geofence/geofence-store';
import { GEOFENCE_TASK, onGeofenceEvent } from '@/src/geofence/geofence-task';
import { GEOFENCE_CHANNEL_ID, requestNearbyAlertPermissions } from '@/src/geofence/permissions';
import { supabase } from '@/src/lib/supabase';
import * as Location from 'expo-location';

jest.mock('@/src/lib/supabase', () => ({
  supabase: { auth: { storageKey: 'sb-test-auth-token', getSession: jest.fn() } },
}));
jest.mock('@/src/geofence/geofence-api', () => ({ fetchOpenCount: jest.fn() }));

const getSession = supabase.auth.getSession as jest.Mock;
const AUTH_KEY = 'sb-test-auth-token';
// 만료된 access token이지만 refresh token은 남아 있는 저장 세션(오프라인에서 갱신 실패 상황).
const storedSession = (over: Record<string, unknown> = {}) =>
  AsyncStorage.setItem(
    AUTH_KEY,
    JSON.stringify({
      access_token: 'expired',
      refresh_token: 'r1',
      expires_at: 1,
      user: { id: 'u1' },
      ...over,
    })
  );
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
    await storedSession();
    // getSession은 오프라인에서 갱신 실패 시 null을 준다. 판단에 쓰지 않아야 한다.
    getSession.mockResolvedValue({ data: { session: null } });
    (fetchOpenCount as jest.Mock).mockResolvedValue(2);
  });

  it('schedules a local notification on Enter', async () => {
    await onGeofenceEvent(body(Location.GeofencingEventType.Enter));
    expect(schedule).toHaveBeenCalledWith({
      content: { title: '이마트 근처예요 · 사야 할 것 2개', data: { listId: 'L1', familyId: 'F1' } },
      trigger: { channelId: GEOFENCE_CHANNEL_ID },
    });
    expect(GEOFENCE_CHANNEL_ID).toBe('default');
  });

  it('still notifies offline with an expired stored session, using the cached count', async () => {
    (fetchOpenCount as jest.Mock).mockRejectedValue(new Error('offline'));
    await setOpenCounts({ L1: 4 });
    await onGeofenceEvent(body(Location.GeofencingEventType.Enter));
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule.mock.calls[0][0].content.title).toBe('이마트 근처예요 · 사야 할 것 4개');
  });

  it('skips without a stored session', async () => {
    await AsyncStorage.removeItem(AUTH_KEY);
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    await onGeofenceEvent(body(Location.GeofencingEventType.Enter));
    expect(schedule).not.toHaveBeenCalled();
  });

  it('skips a stored session without a refresh token or with unreadable data', async () => {
    await storedSession({ refresh_token: '' });
    await onGeofenceEvent(body(Location.GeofencingEventType.Enter));
    await AsyncStorage.setItem(AUTH_KEY, '{not json');
    await onGeofenceEvent(body(Location.GeofencingEventType.Enter));
    expect(schedule).not.toHaveBeenCalled();
  });

  it('handles concurrent Enter events one at a time (one notification per list)', async () => {
    await setRegionMeta({
      r1: { listId: 'L1', familyId: 'F1', groupName: '우리집', placeName: '이마트' },
      r2: { listId: 'L1', familyId: 'F1', groupName: '우리집', placeName: '이마트 별관' },
    });
    await Promise.all([
      onGeofenceEvent(body(Location.GeofencingEventType.Enter, 'r1')),
      onGeofenceEvent(body(Location.GeofencingEventType.Enter, 'r2')),
      onGeofenceEvent(body(Location.GeofencingEventType.Enter, 'r1')),
    ]);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('keeps every list cooldown when different lists enter concurrently', async () => {
    await setRegionMeta({
      r1: { listId: 'L1', familyId: 'F1', groupName: '우리집', placeName: '이마트' },
      r2: { listId: 'L2', familyId: 'F1', groupName: '우리집', placeName: '코스트코' },
    });
    await Promise.all([
      onGeofenceEvent(body(Location.GeofencingEventType.Enter, 'r1')),
      onGeofenceEvent(body(Location.GeofencingEventType.Enter, 'r2')),
    ]);
    expect(Object.keys(await getLastNotified()).sort()).toEqual(['L1', 'L2']);
  });

  it('ignores Exit and errors', async () => {
    await onGeofenceEvent(body(Location.GeofencingEventType.Exit));
    await onGeofenceEvent(body(Location.GeofencingEventType.Enter, 'r1', new Error('x')));
    expect(schedule).not.toHaveBeenCalled();
  });

  it('does not notify when signed out', async () => {
    await AsyncStorage.clear();
    await setRegionMeta({ r1: { listId: 'L1', familyId: 'F1', groupName: '우리집', placeName: '이마트' } });
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
