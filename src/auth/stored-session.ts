import AsyncStorage from '@react-native-async-storage/async-storage';
import { AUTH_STORAGE_KEY } from '@/src/lib/supabase';

/**
 * auth-js가 저장한 세션(AUTH_STORAGE_KEY)을 네트워크 없이 읽는다. 오프라인 콜드 스타트에서 access token이 만료되면
 * 갱신이 실패해 INITIAL_SESSION이 null로 오지만 저장된 세션(refresh token)은 남아 있다 — 이때는 로그아웃이 아니다.
 * refresh token이 없거나 읽을 수 없으면 null. 절대 던지지 않는다.
 */
export async function readStoredSession(): Promise<{ userId: string | null } | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as {
      refresh_token?: unknown;
      user?: { id?: unknown } | null;
    } | null;
    if (typeof stored?.refresh_token !== 'string' || stored.refresh_token.length === 0) return null;
    const id = stored.user?.id;
    return { userId: typeof id === 'string' && id ? id : null };
  } catch {
    return null;
  }
}

/** 저장된 refresh token이 있으면 true(로그인 상태로 본다). */
export async function hasStoredSession(): Promise<boolean> {
  return (await readStoredSession()) !== null;
}
