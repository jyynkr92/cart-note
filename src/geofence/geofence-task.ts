import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AUTH_STORAGE_KEY } from '@/src/lib/supabase';
import { fetchOpenCount } from './geofence-api';
import { setRegionFingerprint } from './geofence-store';
import { handleEnter } from './handle-enter';
import { GEOFENCE_CHANNEL_ID } from './permissions';

export const GEOFENCE_TASK = 'cart-note-geofence';

type GeofenceEvent = { eventType: Location.GeofencingEventType; region: Location.LocationRegion };

/**
 * 로그인 여부를 저장된 세션으로 판단한다. getSession()은 만료된 access token을 갱신하려다
 * 오프라인이면 null을 주므로(캐시 개수로 알려야 하는 바로 그 상황) 쓰지 않는다.
 * 로그아웃은 이 키를 지우고 regionMeta도 비우므로 로그아웃 사용자는 여전히 알림을 받지 않는다.
 */
async function hasSession(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return false;
  try {
    const stored = JSON.parse(raw) as { refresh_token?: unknown } | null;
    return typeof stored?.refresh_token === 'string' && stored.refresh_token.length > 0;
  } catch {
    return false;
  }
}

async function notify(title: string, data: { listId: string; familyId: string }): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title, data },
    trigger: { channelId: GEOFENCE_CHANNEL_ID },
  });
}

async function processEvent({
  data,
  error,
}: TaskManager.TaskManagerTaskBody<GeofenceEvent>): Promise<void> {
  if (error) {
    // OS가 지오펜싱을 멈췄을 수 있다(권한 회수 등). 지문을 지워 다음 동기화가 다시 등록하게 한다.
    try {
      await setRegionFingerprint(null);
    } catch {
      // 백그라운드 작업은 OS로 오류를 던지지 않는다.
    }
    return;
  }
  if (!data) return;
  if (data.eventType !== Location.GeofencingEventType.Enter) return;
  const regionId = data.region?.identifier;
  if (!regionId) return;
  try {
    await handleEnter(regionId, { now: Date.now(), hasSession, fetchOpenCount, notify });
  } catch {
    // 백그라운드 작업에서 던진 오류는 사용자에게 보일 곳이 없다.
  }
}

// iOS는 startGeofencingAsync마다 안에 있는 모든 region의 Enter를 다시 보낸다. 동시에 처리하면
// AsyncStorage의 lastNotified 읽기-수정-쓰기가 겹쳐 중복 알림/쿨다운 유실이 생기므로 한 번에 하나씩 처리한다.
let queue: Promise<void> = Promise.resolve();

/**
 * 백그라운드(headless) 실행 진입점. 진입(Enter) 이벤트만 처리하고 오류는 삼킨다.
 * 앱 UI 없이 실행되므로 필요한 값은 geofence-store(AsyncStorage)와 서버에서 읽는다.
 */
export function onGeofenceEvent(body: TaskManager.TaskManagerTaskBody<GeofenceEvent>): Promise<void> {
  const next = queue.then(() => processEvent(body));
  queue = next.catch(() => {});
  return next;
}

// 작업 정의는 모듈 최상위에서 해야 백그라운드 실행 시 앱 번들 로드만으로 등록된다(index.ts 진입점에서 import).
try {
  TaskManager.defineTask<GeofenceEvent>(GEOFENCE_TASK, onGeofenceEvent);
} catch {
  // 네이티브 모듈이 없는 환경(Expo Go, 웹)에서는 지오펜싱을 쓰지 않는다.
}
