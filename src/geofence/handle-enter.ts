import { canNotify } from './cooldown';
import {
  getCachedOpenCount,
  getGroupCount,
  getLastNotified,
  getRegionMeta,
  markNotified,
} from './geofence-store';
import { notificationText } from './notification-text';

export type EnterDeps = {
  now: number;
  hasSession(): Promise<boolean>;
  fetchOpenCount(listId: string): Promise<number>;
  notify(title: string, data: { listId: string; familyId: string }): Promise<void>;
};

/** 지오펜스 진입 처리. 로그아웃 상태, 모르는 region, 쿨다운 중, 살 것 0개면 알리지 않는다. */
export async function handleEnter(
  regionId: string,
  deps: EnterDeps
): Promise<'notified' | 'skipped'> {
  const signedIn = await deps.hasSession().catch(() => false);
  if (!signedIn) return 'skipped';

  const meta = (await getRegionMeta())[regionId];
  if (!meta) return 'skipped';
  if (!canNotify(meta.listId, deps.now, await getLastNotified())) return 'skipped';

  let count: number | null;
  try {
    count = await deps.fetchOpenCount(meta.listId);
  } catch {
    count = await getCachedOpenCount(meta.listId);
  }
  if (count === 0) return 'skipped';

  const title = notificationText({
    groupName: meta.groupName,
    placeName: meta.placeName,
    count,
    groupCount: await getGroupCount(),
  });
  try {
    await deps.notify(title, { listId: meta.listId, familyId: meta.familyId });
  } catch {
    return 'skipped';
  }
  await markNotified(meta.listId, deps.now);
  return 'notified';
}
