// fetch 실패는 RN에서 TypeError('Network request failed'), supabase-js(postgrest)에서는
// { message: 'TypeError: …' | 'FetchError: …' } 형태로 온다. 감싼 오류는 cause를 따라간다.
const NETWORK_RE = /network request failed|failed to fetch|fetcherror|typeerror|load failed|timed? ?out/i;

/** 연결 문제(서버가 응답하지 않음)로 보이는 오류인지. 권한/검증 같은 서버 응답 오류는 false. */
export function isNetworkError(e: unknown, depth = 0): boolean {
  if (!e || depth > 3) return false;
  if (e instanceof TypeError) return true;
  const { message, cause, name } = e as { message?: unknown; cause?: unknown; name?: unknown };
  if (name === 'AuthRetryableFetchError') return true;
  if (typeof message === 'string' && NETWORK_RE.test(message)) return true;
  return isNetworkError(cause, depth + 1);
}
