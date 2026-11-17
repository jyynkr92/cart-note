import { supabase } from '@/src/lib/supabase';

/**
 * 큐 요청 직전의 실제 세션 확인(session-gate에 설치). getSession()은 만료된 access token을 갱신하려 하고,
 * 갱신이 실패하면(오프라인 등) 세션 없이 돌아온다 — 그때 요청을 보내면 anon 키로 나간다. 절대 던지지 않는다.
 */
export async function liveSessionCheck(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session;
  } catch {
    return false;
  }
}
