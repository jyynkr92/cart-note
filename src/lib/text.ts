export function normalizeName(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

/** 텍스트 최대 길이(문자 수). DB CHECK(0008_constraints.sql)와 같은 값이다. */
export const MAX_LENGTH = {
  displayName: 50,
  groupName: 50,
  listName: 50,
  itemName: 200,
  itemNote: 1000,
  placeName: 200,
  address: 300,
} as const;

/** 문자(코드 포인트) 단위로 자른다. DB char_length와 같은 단위라 이모지가 반쪽(서로게이트)으로 잘리지 않는다. */
export function truncateCodePoints(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join('');
}

/** 초대 코드 자릿수(보안 점검 /cso 반영으로 6 → 8). */
export const INVITE_CODE_LENGTH = 8;

/** 숫자만 남기고 정확히 8자리일 때만 반환한다(앞자리 0 보존을 위해 문자열). */
export function normalizeInviteCode(s: string): string | null {
  const digits = s.replace(/\D/g, '');
  return digits.length === INVITE_CODE_LENGTH ? digits : null;
}
