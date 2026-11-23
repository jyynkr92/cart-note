import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeInviteCode } from '@/src/lib/text';

const KEY = 'cartnote.pendingInvite';

/** 초대 코드 수명(서버 invite_code_expires_at, 7일). 이보다 오래된 대기 코드는 이미 만료됐다. */
export const PENDING_INVITE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Stored = { code: string; at: number };

function parse(raw: string): Stored | null {
  try {
    const v = JSON.parse(raw) as Partial<Stored> | null;
    if (typeof v?.code === 'string' && typeof v.at === 'number') return { code: v.code, at: v.at };
  } catch {
    // 이전 형식(코드만 저장)은 저장 시각을 알 수 없으므로 없는 것으로 본다.
  }
  return null;
}

/** 대기 중인 초대 코드. 저장한 지 7일이 지났거나 형식이 맞지 않으면 지우고 null. */
export async function getPendingInvite(now: number = Date.now()): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === null) return null;
    const stored = parse(raw);
    const code = stored ? normalizeInviteCode(stored.code) : null;
    const age = stored ? now - stored.at : NaN;
    // 나이가 음수면(기기 시계를 되돌림) 실제 나이를 알 수 없으므로 만료로 본다.
    if (!stored || !code || !(age >= 0 && age <= PENDING_INVITE_MAX_AGE_MS)) {
      await AsyncStorage.removeItem(KEY).catch(() => {});
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export async function setPendingInvite(code: string, capturedAt: number = Date.now()): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify({ code, at: capturedAt } satisfies Stored));
}

export async function clearPendingInvite(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

const JOIN_URL_RE = /^cartnote:\/\/join\/?\?([^#]*)/;

/** `cartnote://join?code=XXXXXXXX` → 검증된 8자리 코드, 아니면 null. */
export function parseJoinUrl(url: string): string | null {
  const m = JOIN_URL_RE.exec(url);
  if (!m) return null;
  const code = new URLSearchParams(m[1]).get('code');
  return code ? normalizeInviteCode(code) : null;
}

/** 초대 딥링크면 코드를 받은 시각과 함께 대기 저장소에 넣고 true. */
export async function capturePendingInvite(
  url: string | null,
  now: number = Date.now()
): Promise<boolean> {
  if (!url) return false;
  const code = parseJoinUrl(url);
  if (!code) return false;
  await setPendingInvite(code, now);
  return true;
}
