import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { useCurrentGroupStore } from '@/src/groups/current-group-store';

export type OpenTarget = { listId: string; familyId: string };

/**
 * 알림 탭으로 열어야 할 목록. 루트 레이아웃이 응답을 받아 여기 두고, (app) 레이아웃이
 * 인증/온보딩 가드를 통과한(ready) 뒤에 소비한다(가드의 리다이렉트와 경합하지 않도록).
 */
let pending: OpenTarget | null = null;
const handled = new Set<string>(); // 콜드 스타트 응답과 리스너가 같은 응답을 두 번 줄 수 있다.
const listeners = new Set<() => void>();

function setPending(next: OpenTarget | null) {
  pending = next;
  for (const l of listeners) l();
}

export function getPendingOpen(): OpenTarget | null {
  return pending;
}

/** 테스트용 */
export function resetPendingOpen(opts: { keepHandled?: boolean } = {}) {
  if (!opts.keepHandled) handled.clear();
  setPending(null);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

function accept(response: Notifications.NotificationResponse | null | undefined) {
  const request = response?.notification?.request;
  if (!request || handled.has(request.identifier)) return;
  const data = request.content?.data as Record<string, unknown> | undefined;
  const listId = data?.listId;
  const familyId = data?.familyId;
  if (typeof listId !== 'string' || typeof familyId !== 'string') return;
  handled.add(request.identifier);
  setPending({ listId, familyId });
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    // 무시
  }
}

/** 앱이 포그라운드일 때도 알림을 배너로 보여 준다. 모듈 최상위(앱 시작)에서 한 번 호출한다. */
export function setupNotificationHandler(): void {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // 네이티브 모듈이 없는 환경
  }
}

/** 알림 탭 응답(실행 중 + 콜드 스타트)을 받아 열 목록을 기록한다. 루트 레이아웃에서 쓴다. */
export function useNotificationResponses(): void {
  useEffect(() => {
    let alive = true;
    let sub: { remove(): void } | null = null;
    try {
      sub = Notifications.addNotificationResponseReceivedListener(accept);
    } catch {
      sub = null;
    }
    Promise.resolve()
      .then(() => Notifications.getLastNotificationResponseAsync())
      .then((r) => {
        if (alive) accept(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
}

/**
 * 앱이 준비(ready)되고 그룹 목록을 알면, 알림의 그룹으로 전환한 뒤 목록 화면을 연다.
 * 더 이상 속하지 않은 그룹의 알림은 버린다.
 */
export function useOpenPendingNotification(
  ready: boolean,
  families: readonly { id: string }[] | undefined
): void {
  const target = useSyncExternalStore(subscribe, getPendingOpen, getPendingOpen);
  const { setFamilyId } = useCurrentGroupStore();
  useEffect(() => {
    if (!ready || !target || !families) return;
    setPending(null);
    if (!families.some((f) => f.id === target.familyId)) return;
    setFamilyId(target.familyId);
    router.push({ pathname: '/list/[id]', params: { id: target.listId } });
  }, [ready, target, families, setFamilyId]);
}
