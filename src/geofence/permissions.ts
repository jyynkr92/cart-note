import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

async function granted(request: () => Promise<{ status: string }>): Promise<boolean> {
  try {
    return (await request()).status === 'granted';
  } catch {
    return false;
  }
}

/** 알림 → 위치(앱 사용 중) → 위치(항상 허용) 순으로 요청한다. 하나라도 거부되면 'denied'. */
export async function requestNearbyAlertPermissions(): Promise<'granted' | 'denied'> {
  // Android 13+는 채널이 있어야 알림 권한 요청 창이 뜬다. 진입 알림도 이 기본 채널로 간다.
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('default', {
        name: '근처 마트 알림',
        importance: Notifications.AndroidImportance.HIGH,
      });
    } catch {
      // 채널 생성 실패는 권한 요청을 막지 않는다.
    }
  }
  if (!(await granted(() => Notifications.requestPermissionsAsync()))) return 'denied';
  if (!(await granted(() => Location.requestForegroundPermissionsAsync()))) return 'denied';
  if (!(await granted(() => Location.requestBackgroundPermissionsAsync()))) return 'denied';
  return 'granted';
}

/** 백그라운드 위치 권한이 지금도 허용돼 있는지(설정에서 철회됐을 수 있다). */
export function hasBackgroundLocationPermission(): Promise<boolean> {
  return granted(() => Location.getBackgroundPermissionsAsync());
}
