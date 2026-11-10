export function normalizeName(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

/** 숫자만 남기고 정확히 6자리일 때만 반환한다(앞자리 0 보존을 위해 문자열). */
export function normalizeInviteCode(s: string): string | null {
  const digits = s.replace(/\D/g, '');
  return digits.length === 6 ? digits : null;
}
