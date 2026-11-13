import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeInviteCode } from '@/src/lib/text';

const KEY = 'cartnote.pendingInvite';

export async function getPendingInvite(): Promise<string | null> {
  try {
    return normalizeInviteCode((await AsyncStorage.getItem(KEY)) ?? '');
  } catch {
    return null;
  }
}

export async function setPendingInvite(code: string): Promise<void> {
  await AsyncStorage.setItem(KEY, code);
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

/** 초대 딥링크면 코드를 대기 저장소에 넣고 true. */
export async function capturePendingInvite(url: string | null): Promise<boolean> {
  if (!url) return false;
  const code = parseJoinUrl(url);
  if (!code) return false;
  await setPendingInvite(code);
  return true;
}
