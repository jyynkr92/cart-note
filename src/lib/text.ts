export function normalizeName(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

/** 초대 코드 자릿수(보안 점검 /cso 반영으로 6 → 8). */
export const INVITE_CODE_LENGTH = 8;

/** 숫자만 남기고 정확히 8자리일 때만 반환한다(앞자리 0 보존을 위해 문자열). */
export function normalizeInviteCode(s: string): string | null {
  const digits = s.replace(/\D/g, '');
  return digits.length === INVITE_CODE_LENGTH ? digits : null;
}
