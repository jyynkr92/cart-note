import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '@/src/lib/supabase';
import { fetchOpenCount } from './geofence-api';
import { handleEnter } from './handle-enter';

export const GEOFENCE_TASK = 'cart-note-geofence';

type GeofenceEvent = { eventType: Location.GeofencingEventType; region: Location.LocationRegion };

async function hasSession(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

async function notify(title: string, data: { listId: string; familyId: string }): Promise<void> {
  await Notifications.scheduleNotificationAsync({ content: { title, data }, trigger: null });
}

/**
 * 백그라운드(headless) 실행 진입점. 진입(Enter) 이벤트만 처리하고 오류는 삼킨다.
 * 앱 UI 없이 실행되므로 필요한 값은 geofence-store(AsyncStorage)와 서버에서 읽는다.
 */
export async function onGeofenceEvent({
  data,
  error,
}: TaskManager.TaskManagerTaskBody<GeofenceEvent>): Promise<void> {
  if (error || !data) return;
  if (data.eventType !== Location.GeofencingEventType.Enter) return;
  const regionId = data.region?.identifier;
  if (!regionId) return;
  try {
    await handleEnter(regionId, { now: Date.now(), hasSession, fetchOpenCount, notify });
  } catch {
    // 백그라운드 작업에서 던진 오류는 사용자에게 보일 곳이 없다.
  }
}

// 작업 정의는 모듈 최상위에서 해야 백그라운드 실행 시 앱 번들 로드만으로 등록된다(app/_layout.tsx에서 import).
try {
  TaskManager.defineTask<GeofenceEvent>(GEOFENCE_TASK, onGeofenceEvent);
} catch {
  // 네이티브 모듈이 없는 환경(Expo Go, 웹)에서는 지오펜싱을 쓰지 않는다.
}
