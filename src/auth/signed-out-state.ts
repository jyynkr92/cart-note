import type { QueryClient } from '@tanstack/react-query';
import { resetGeofencing } from '@/src/geofence/sync-geofences';
import { clearCurrentGroup } from '@/src/groups/current-group-store';
import { syncCacheOwner } from '@/src/lib/query-client';
import { closeSession, openSession } from '@/src/lib/session-gate';
import { clearOnboarded } from '@/src/onboarding/onboarded-flag';
import { hasStoredSession } from './stored-session';

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

/**
 * 복원이 끝난 뒤(앱 시작/사용자 변경): 디스크 캐시 소유자를 맞추고, 그 다음에만 대기 중인 mutation을 재개한다
 * (다른 사용자의 큐가 실행되지 않도록). 복원된 세션에 사용자가 없으면 SIGNED_OUT 이벤트 없이 끝난 로그아웃
 * (예: 앱이 꺼진 사이 만료)일 수 있으므로 기기 로컬 사용자별 상태도 지운다. 절대 던지지 않는다.
 */
export async function reconcileCacheOwner(client: QueryClient, userId: string | null): Promise<void> {
  // 세션은 없지만 refresh token이 저장돼 있으면 오프라인 갱신 실패다(로그아웃 아님): 캐시/큐/기기 상태를 그대로 두고,
  // 소유자를 확정할 수 없으니 큐도 재개하지 않는다. 세션이 돌아오면(userId) 다시 불려 재개한다.
  // 세션이 없으면 큐/쿼리 게이트를 닫는다(오프라인 사용자 모드 포함: 세션 없이 큐가 재생되면 anon으로 나간다).
  if (userId === null) closeSession();
  if (userId === null && (await hasStoredSession())) return;
  try {
    await syncCacheOwner(client, userId);
  } catch {
    // 소유자를 확인하지 못했으면 큐를 재개하지 않는다. 로그아웃 상태 정리는 그래도 한다.
    if (userId === null) await clearSignedOutDeviceState();
    return;
  }
  if (userId === null) {
    await clearSignedOutDeviceState();
    return;
  }
  // 소유자 확인이 끝난 사용자의 세션으로만 게이트를 연다(열리면 QueryClient가 큐를 재개한다).
  openSession(userId);
  await client.resumePausedMutations().catch(() => {});
}
