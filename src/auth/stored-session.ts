import AsyncStorage from '@react-native-async-storage/async-storage';
import { AUTH_STORAGE_KEY } from '@/src/lib/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * auth-js가 저장한 세션(AUTH_STORAGE_KEY)을 네트워크 없이 읽는다. 오프라인 콜드 스타트에서 access token이 만료되면
 * 갱신이 실패해 INITIAL_SESSION이 null로 오지만 저장된 세션(refresh token)은 남아 있다 — 이때는 로그아웃이 아니다.
 * 유효한 저장 세션 = refresh token이 있고 user.id가 uuid 형태. 아니면 null(로그인 앱 상태/지오펜스 판단 모두 같은 기준).
 * 절대 던지지 않는다.
 */
export async function readStoredSession(): Promise<{ userId: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as {
      refresh_token?: unknown;
      user?: { id?: unknown } | null;
    } | null;
    if (typeof stored?.refresh_token !== 'string' || stored.refresh_token.length === 0) return null;
    const id = stored.user?.id;
    if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
    return { userId: id };
  } catch {
    return null;
  }
}

/** 유효한 저장 세션(refresh token + uuid user id)이 있으면 true(로그인 상태로 본다). */
export async function hasStoredSession(): Promise<boolean> {
  return (await readStoredSession()) !== null;
}
