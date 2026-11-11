import {
  fetchAllMyLocations,
  insertLocation,
  searchPlaces,
} from '@/src/locations/location-api';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({
  supabase: { from: jest.fn(), functions: { invoke: jest.fn() } },
}));

const from = supabase.from as jest.Mock;
const invoke = (supabase.functions as unknown as { invoke: jest.Mock }).invoke;

const place = {
  kakao_place_id: 'k1',
  place_name: '코스트코 양재점',
  address: '서울',
  lat: 37.4,
  lng: 127,
};

beforeEach(() => jest.clearAllMocks());

describe('fetchAllMyLocations', () => {
  it('flattens the nested lists/families embed into list_name and family_name', async () => {
    const select = jest.fn().mockResolvedValue({
      error: null,
      data: [
        {
          id: 'a',
          list_id: 'l1',
          family_id: 'g1',
          place_name: '양재점',
          address: '서울',
          lat: 1,
          lng: 2,
          kakao_place_id: 'k1',
          radius_m: 300,
          lists: { name: '코스트코', families: { name: '우리집' } },
        },
      ],
    });
    from.mockReturnValue({ select });
    const rows = await fetchAllMyLocations();
    expect(from).toHaveBeenCalledWith('list_locations');
    expect(select).toHaveBeenCalledWith('*, lists!inner(name, families!inner(name))');
    expect(rows).toEqual([
      {
        id: 'a',
        list_id: 'l1',
        family_id: 'g1',
        place_name: '양재점',
        address: '서울',
        lat: 1,
        lng: 2,
        kakao_place_id: 'k1',
        radius_m: 300,
        list_name: '코스트코',
        family_name: '우리집',
      },
    ]);
    expect(rows[0]).not.toHaveProperty('lists');
  });

  it('throws on a query error', async () => {
    from.mockReturnValue({ select: jest.fn().mockResolvedValue({ error: new Error('x'), data: null }) });
    await expect(fetchAllMyLocations()).rejects.toThrow('x');
  });
});

describe('insertLocation', () => {
  const row = { id: 'i1', listId: 'l1', familyId: 'g1', place, radiusM: 300 };

  it('sends only the insertable columns', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    from.mockReturnValue({ upsert });
    await insertLocation(row);
    expect(upsert).toHaveBeenCalledWith(
      {
        id: 'i1',
        list_id: 'l1',
        family_id: 'g1',
        place_name: '코스트코 양재점',
        address: '서울',
        lat: 37.4,
        lng: 127,
        kakao_place_id: 'k1',
        radius_m: 300,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    );
  });

  it('treats a unique violation (same place already on the list) as success', async () => {
    from.mockReturnValue({
      upsert: jest.fn().mockResolvedValue({ error: { code: '23505', message: 'dup' } }),
    });
    await expect(insertLocation(row)).resolves.toBeUndefined();
  });

  it('still throws other errors', async () => {
    from.mockReturnValue({
      upsert: jest.fn().mockResolvedValue({ error: { code: '42501', message: 'denied' } }),
    });
    await expect(insertLocation(row)).rejects.toMatchObject({ code: '42501' });
  });
});

it('searchPlaces invokes the edge function and returns places', async () => {
  invoke.mockResolvedValue({ data: { places: [place] }, error: null });
  await expect(searchPlaces('코스트코')).resolves.toEqual([place]);
  expect(invoke).toHaveBeenCalledWith('kakao-place-search', { body: { query: '코스트코' } });
});
