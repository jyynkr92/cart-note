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

// PKCE 매직링크: `cartnote://auth?code=…`. 프래그먼트(#)가 붙은 링크는 암묵적 흐름의 토큰일 수 있으므로
// 아예 받지 않는다. 남이 보낸 토큰으로 이 기기가 그 사람 계정에 로그인되는 것(세션 바꿔치기)을 막는다.
const AUTH_LINK_RE = /^cartnote:\/\/auth\/?\?([^#]*)$/;
const FLOW_ID_RE = /^[0-9a-f]{32}$/;

/** `cartnote://auth?code=…` → code (and the SDK flow id when present), or null. Other URLs are rejected. */
export function parseAuthCode(url: string): { code: string; flowId?: string } | null {
  const match = AUTH_LINK_RE.exec(url);
  if (!match) return null;
  const params = new URLSearchParams(match[1]);
  const code = params.get('code');
  if (!code) return null;
  const flowId = params.get('sb_flow_id');
  return flowId && FLOW_ID_RE.test(flowId) ? { code, flowId } : { code };
}

/**
 * 링크의 코드를 세션으로 교환한다. 코드 검증자(code verifier)는 링크를 요청한 기기의 저장소에만 있으므로
 * 다른 사람이 보낸 코드는 교환에 실패한다.
 */
export async function exchangeCodeFromUrl(url: string): Promise<void> {
  const parsed = parseAuthCode(url);
  if (!parsed) throw new Error('invalid auth link');
  const { error } = await supabase.auth.exchangeCodeForSession(
    parsed.code,
    parsed.flowId ? { flowId: parsed.flowId } : undefined,
  );
  if (error) throw error;
}
