// 서버가 응답하지 못한 경우만 연결 오류로 본다. RN fetch는 TypeError('Network request failed'),
// 브라우저는 TypeError('Failed to fetch'), postgrest는 이를 { message: 'TypeError: …' }로 감싼다.
// 우리 AbortSignal의 중단/시간 초과(AbortError, TimeoutError)도 포함한다.
// 일반 TypeError(코드 버그)나 postgres 'statement timeout'(서버가 응답함)은 연결 오류가 아니다.
const FETCH_FAILURE_RE = /network request failed|failed to fetch/i;
const ABORT_RE = /^(AbortError|TimeoutError)\b/;
const ABORT_NAMES = new Set(['AbortError', 'TimeoutError', 'AuthRetryableFetchError']);

/** 연결 문제(서버가 응답하지 않음)로 보이는 오류인지. 감싼 오류는 cause를 따라간다. */
export function isNetworkError(e: unknown, depth = 0): boolean {
  if (!e || depth > 3) return false;
  const { message, cause, name } = e as { message?: unknown; cause?: unknown; name?: unknown };
  if (typeof name === 'string' && ABORT_NAMES.has(name)) return true;
  if (typeof message === 'string' && (FETCH_FAILURE_RE.test(message) || ABORT_RE.test(message))) {
    return true;
  }
  return isNetworkError(cause, depth + 1);
}
