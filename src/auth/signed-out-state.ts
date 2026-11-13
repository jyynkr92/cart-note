import { resetGeofencing } from '@/src/geofence/sync-geofences';
import { clearCurrentGroup } from '@/src/groups/current-group-store';
import { clearOnboarded } from '@/src/onboarding/onboarded-flag';

/**
 * 로그아웃 상태에서 남아 있으면 안 되는 기기 로컬 사용자별 상태(현재 그룹, 지오펜스 등록/메타, 온보딩 표시)를 지운다.
 * 쿼리 캐시는 호출부가 지운다. 초대 대기 코드는 로그아웃 버튼에서만 지운다. 절대 던지지 않는다.
 */
export async function clearSignedOutDeviceState(): Promise<void> {
  await Promise.all([
    clearCurrentGroup().catch(() => {}),
    resetGeofencing().catch(() => {}),
    clearOnboarded().catch(() => {}),
  ]);
}
