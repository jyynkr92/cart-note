// Deno/React Native 어느 쪽에서도 타입 검사되도록 표준 Web API(Request/Response/fetch)만 쓴다.

export type Place = {
  kakao_place_id: string;
  place_name: string;
  address: string;
  lat: number;
  lng: number;
};

export type Deps = {
  fetch: typeof fetch;
  kakaoKey: string;
  getUser: (authHeader: string) => Promise<{ id: string } | null>;
  /** 호출자 권한으로 사용자별 할당량을 1회 소비한다. 초과면 false. */
  consumeQuota: (authHeader: string) => Promise<boolean>;
};

const KAKAO_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const MAX_QUERY_LENGTH = 100;
const PAGE_SIZE = 15;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

type KakaoDoc = {
  id?: unknown;
  place_name?: unknown;
  road_address_name?: unknown;
  address_name?: unknown;
  x?: unknown;
  y?: unknown;
};

function toPlace(doc: KakaoDoc): Place | null {
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (doc.id === undefined || doc.id === null || doc.id === '') return null;
  return {
    kakao_place_id: String(doc.id),
    place_name: String(doc.place_name ?? ''),
    address: String(doc.road_address_name || doc.address_name || ''),
    lat,
    lng,
  };
}

/**
 * 응답 상태 코드:
 * - 200 `{ places }`
 * - 400 query 누락/본문 오류, 401 인증 실패, 405 POST 외 메서드
 * - 429 `{ error: 'rate_limited' }` 사용자별 할당량(시간당 60회) 초과
 * - 500 `{ error: 'search unavailable' }` 서버에 KAKAO_REST_KEY가 없음(설정 오류)
 * - 503 `{ error: 'search unavailable' }` 할당량 RPC(consume_search_quota) 실패. 확인하지 못하면 카카오를
 *   호출하지 않는다(fail closed). 일시적 장애이므로 클라이언트는 나중에 다시 시도하면 된다.
 * - 502 `{ error: 'search failed' }` 카카오 호출 실패/비정상 응답
 */
export async function handlePlaceSearch(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' }, { Allow: 'POST' });

  const auth = req.headers.get('Authorization');
  if (!auth) return json(401, { error: 'unauthorized' });
  let user: { id: string } | null = null;
  try {
    user = await deps.getUser(auth);
  } catch {
    user = null;
  }
  if (!user) return json(401, { error: 'unauthorized' });

  let query: string;
  try {
    const body = await req.json();
    if (typeof body?.query !== 'string') return json(400, { error: 'query required' });
    query = body.query.trim().slice(0, MAX_QUERY_LENGTH).trim();
  } catch {
    return json(400, { error: 'invalid body' });
  }
  if (!query) return json(400, { error: 'query required' });

  if (!deps.kakaoKey) return json(500, { error: 'search unavailable' });

  // 카카오 호출 전에 사용자별 할당량을 소비한다. 확인이 실패하면 막는다(fail closed).
  let allowed: boolean;
  try {
    allowed = await deps.consumeQuota(auth);
  } catch {
    console.error('search quota check failed');
    return json(503, { error: 'search unavailable' });
  }
  if (!allowed) return json(429, { error: 'rate_limited' });

  try {
    const url = `${KAKAO_URL}?${new URLSearchParams({ query, size: String(PAGE_SIZE) })}`;
    const res = await deps.fetch(url, { headers: { Authorization: `KakaoAK ${deps.kakaoKey}` } });
    if (!res.ok) {
      // 상태 코드만 남긴다(응답 본문과 키는 로그에도 남기지 않는다).
      console.error('kakao search upstream status', res.status);
      return json(502, { error: 'search failed' });
    }
    const data = await res.json();
    const docs: unknown[] = Array.isArray(data?.documents) ? data.documents : [];
    const places = docs
      .map((d) => toPlace((d ?? {}) as KakaoDoc))
      .filter((p): p is Place => p !== null);
    return json(200, { places });
  } catch (e) {
    console.error('kakao search failed', e instanceof Error ? e.name : typeof e);
    return json(502, { error: 'search failed' });
  }
}
