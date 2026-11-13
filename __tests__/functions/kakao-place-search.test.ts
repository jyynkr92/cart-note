import { handlePlaceSearch, type Deps } from '@/supabase/functions/kakao-place-search/handler';

const URL_ = 'http://localhost/functions/v1/kakao-place-search';
const post = (body: unknown, headers: Record<string, string> = { Authorization: 'Bearer t' }) =>
  new Request(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const kakaoOk = (documents: unknown[]) =>
  Promise.resolve(new Response(JSON.stringify({ documents }), { status: 200 }));

function deps(
  over: Partial<Deps> = {},
): Deps & { fetch: jest.Mock; getUser: jest.Mock; consumeQuota: jest.Mock } {
  return {
    fetch: jest.fn(() => kakaoOk([])),
    kakaoKey: 'SECRET-KEY',
    getUser: jest.fn(async () => ({ id: 'u1' })),
    consumeQuota: jest.fn(async () => true),
    ...over,
  } as Deps & { fetch: jest.Mock; getUser: jest.Mock; consumeQuota: jest.Mock };
}

it('maps kakao documents to places', async () => {
  const d = deps({
    fetch: jest.fn(() =>
      kakaoOk([
        {
          id: '123',
          place_name: '코스트코 양재점',
          road_address_name: '서울 서초구 양재대로 159',
          address_name: '서울 서초구 양재동 1',
          x: '127.0357',
          y: '37.4664',
        },
        { id: '456', place_name: '이마트', road_address_name: '', address_name: '지번 주소', x: '1', y: '2' },
      ])
    ),
  });
  const res = await handlePlaceSearch(post({ query: '코스트코 양재' }), d);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    places: [
      {
        kakao_place_id: '123',
        place_name: '코스트코 양재점',
        address: '서울 서초구 양재대로 159',
        lat: 37.4664,
        lng: 127.0357,
      },
      { kakao_place_id: '456', place_name: '이마트', address: '지번 주소', lat: 2, lng: 1 },
    ],
  });
});

it('calls kakao with the key, trimmed query and size <= 15', async () => {
  const d = deps();
  await handlePlaceSearch(post({ query: '  코스트코  ' }), d);
  const [url, init] = d.fetch.mock.calls[0];
  const u = new URL(url as string);
  expect(`${u.origin}${u.pathname}`).toBe('https://dapi.kakao.com/v2/local/search/keyword.json');
  expect(u.searchParams.get('query')).toBe('코스트코');
  expect(Number(u.searchParams.get('size'))).toBeLessThanOrEqual(15);
  expect((init as RequestInit).headers).toEqual({ Authorization: 'KakaoAK SECRET-KEY' });
});

it('clamps the query length', async () => {
  const d = deps();
  await handlePlaceSearch(post({ query: 'a'.repeat(500) }), d);
  expect(new URL(d.fetch.mock.calls[0][0] as string).searchParams.get('query')).toHaveLength(100);
});

it('skips results with non-numeric coordinates', async () => {
  const d = deps({
    fetch: jest.fn(() =>
      kakaoOk([
        { id: '1', place_name: 'bad', address_name: 'a', x: 'abc', y: '2' },
        { id: '2', place_name: 'missing', address_name: 'a' },
        { id: '3', place_name: 'ok', address_name: 'a', x: '3', y: '4' },
      ])
    ),
  });
  const body = await (await handlePlaceSearch(post({ query: 'q' }), d)).json();
  expect(body.places.map((p: { kakao_place_id: string }) => p.kakao_place_id)).toEqual(['3']);
});

describe('auth', () => {
  it('401 without an Authorization header', async () => {
    const d = deps();
    const res = await handlePlaceSearch(post({ query: 'q' }, {}), d);
    expect(res.status).toBe(401);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('401 when the header does not verify to a user', async () => {
    const d = deps({ getUser: jest.fn(async () => null) });
    const res = await handlePlaceSearch(post({ query: 'q' }), d);
    expect(res.status).toBe(401);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('401 when verification throws', async () => {
    const d = deps({ getUser: jest.fn(async () => Promise.reject(new Error('boom'))) });
    expect((await handlePlaceSearch(post({ query: 'q' }), d)).status).toBe(401);
  });
});

describe('request validation', () => {
  it.each([[{ query: '   ' }], [{ query: '' }], [{}], [{ query: 5 }]])('400 for %j', async (b) => {
    expect((await handlePlaceSearch(post(b), deps())).status).toBe(400);
  });

  it('400 for an unparsable body', async () => {
    expect((await handlePlaceSearch(post('{not json'), deps())).status).toBe(400);
  });

  it('405 for non-POST methods', async () => {
    const req = new Request(URL_, { method: 'GET', headers: { Authorization: 'Bearer t' } });
    const res = await handlePlaceSearch(req, deps());
    expect(res.status).toBe(405);
  });
});

describe('upstream failures', () => {
  it('502 when fetch rejects', async () => {
    const d = deps({ fetch: jest.fn(() => Promise.reject(new Error('net'))) });
    expect((await handlePlaceSearch(post({ query: 'q' }), d)).status).toBe(502);
  });

  it('502 on non-2xx without leaking the upstream body or key', async () => {
    const d = deps({
      fetch: jest.fn(() =>
        Promise.resolve(new Response('upstream says SECRET-KEY is invalid', { status: 401 }))
      ),
    });
    const res = await handlePlaceSearch(post({ query: 'q' }), d);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('SECRET-KEY');
    expect(text).not.toContain('upstream');
  });

  it('502 on invalid JSON from kakao', async () => {
    const d = deps({ fetch: jest.fn(() => Promise.resolve(new Response('<html>', { status: 200 }))) });
    expect((await handlePlaceSearch(post({ query: 'q' }), d)).status).toBe(502);
  });

  it('500 with a generic message when the key is missing', async () => {
    const d = deps({ kakaoKey: '' });
    const res = await handlePlaceSearch(post({ query: 'q' }), d);
    expect(res.status).toBe(500);
    expect(d.fetch).not.toHaveBeenCalled();
  });
});

describe('per-user quota', () => {
  it('consumes quota with the caller\'s auth header before calling kakao', async () => {
    const d = deps();
    const res = await handlePlaceSearch(post({ query: '코스트코' }, { Authorization: 'Bearer user-jwt' }), d);
    expect(res.status).toBe(200);
    expect(d.consumeQuota).toHaveBeenCalledWith('Bearer user-jwt');
    expect(d.consumeQuota.mock.invocationCallOrder[0]).toBeLessThan(d.fetch.mock.invocationCallOrder[0]);
  });

  it('429 rate_limited when the quota is used up, without calling kakao', async () => {
    const d = deps({ consumeQuota: jest.fn(async () => false) });
    const res = await handlePlaceSearch(post({ query: '코스트코' }), d);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('fails closed when the quota check errors', async () => {
    const d = deps({ consumeQuota: jest.fn(async () => Promise.reject(new Error('db down'))) });
    const res = await handlePlaceSearch(post({ query: '코스트코' }), d);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('does not consume quota for unauthenticated requests', async () => {
    const d = deps({ getUser: jest.fn(async () => null) });
    expect((await handlePlaceSearch(post({ query: 'q' }), d)).status).toBe(401);
    expect(d.consumeQuota).not.toHaveBeenCalled();
  });
});
