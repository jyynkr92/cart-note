export const NOTIFY_COOLDOWN_MS = 3 * 60 * 60 * 1000;

/** 같은 목록은 마지막 알림 뒤 cooldownMs가 지나야 다시 알린다. */
export function canNotify(
  listId: string,
  now: number,
  last: Record<string, number>,
  cooldownMs = NOTIFY_COOLDOWN_MS
): boolean {
  const at = last[listId];
  return at === undefined || now - at >= cooldownMs;
}
