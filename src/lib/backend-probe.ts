const PROBE_TIMEOUT_MS = 5_000;

/**
 * Supabase에 닿는지 확인한다. 쓰기가 가는 PostgREST(/rest/v1/)에 묻는다(인증 서버만 살아 있는 경우를 걸러낸다).
 * HTTP 응답이 오면 상태 코드와 관계없이 닿는 것으로 보고,
 * fetch가 던지거나(연결 실패) 시간 초과면 닿지 않는 것으로 본다. 절대 던지지 않는다.
 */
export async function probeBackend(url: string, anonKey: string): Promise<boolean> {
  if (!url) return false;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
      headers: { apikey: anonKey },
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
