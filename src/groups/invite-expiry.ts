/** 초대 코드 만료 표시. `now`는 호출부에서 한 번만 계산해 넘긴다. */
export function inviteExpiry(
  expiresAt: string,
  now: number,
): { expired: boolean; label: string | null } {
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return { expired: false, label: null };
  if (at.getTime() <= now) return { expired: true, label: null };
  return { expired: false, label: `${at.getMonth() + 1}월 ${at.getDate()}일까지 유효` };
}
