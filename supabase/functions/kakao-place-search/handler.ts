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

  try {
    const url = `${KAKAO_URL}?${new URLSearchParams({ query, size: String(PAGE_SIZE) })}`;
    const res = await deps.fetch(url, { headers: { Authorization: `KakaoAK ${deps.kakaoKey}` } });
    if (!res.ok) return json(502, { error: 'search failed' });
    const data = await res.json();
    const docs: unknown[] = Array.isArray(data?.documents) ? data.documents : [];
    const places = docs
      .map((d) => toPlace((d ?? {}) as KakaoDoc))
      .filter((p): p is Place => p !== null);
    return json(200, { places });
  } catch {
    return json(502, { error: 'search failed' });
  }
}
