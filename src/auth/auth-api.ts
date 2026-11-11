import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { supabase } from '@/src/lib/supabase';

export async function sendOtp(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: 'cartnote://auth' },
  });
  if (error) throw error;
}

export async function verifyOtp(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  // 이 기기의 세션만 끝낸다. 저장된 세션은 서버 응답과 관계없이 먼저 지워지고 SIGNED_OUT이 나가므로,
  // 오프라인에서 서버 로그아웃 요청만 실패한 경우(재시도 가능한 네트워크 오류)는 성공으로 본다.
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error && !isAuthRetryableFetchError(error)) throw error;
}

const AUTH_LINK_RE = /^cartnote:\/\/auth\/?(?:\?[^#]*)?#(.+)$/;

/** `cartnote://auth#access_token=…&refresh_token=…` → tokens, or null. Other URLs are rejected. */
export function parseAuthFragment(
  url: string,
): { access_token: string; refresh_token: string } | null {
  const match = AUTH_LINK_RE.exec(url);
  if (!match) return null;
  const params = new URLSearchParams(match[1]);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return null;
  return { access_token, refresh_token };
}

export async function setSessionFromUrl(url: string): Promise<void> {
  const tokens = parseAuthFragment(url);
  if (!tokens) throw new Error('invalid auth link');
  const { error } = await supabase.auth.setSession(tokens);
  if (error) throw error;
}
