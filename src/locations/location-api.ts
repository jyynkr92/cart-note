import { supabase } from '@/src/lib/supabase';
import type { Database } from '@/src/lib/database.types';
import { SearchRateLimitedError } from './search-errors';

export type ListLocation = Database['public']['Tables']['list_locations']['Row'];
export type Place = {
  kakao_place_id: string;
  place_name: string;
  address: string;
  lat: number;
  lng: number;
};
export type MyLocation = ListLocation & { list_name: string; family_name: string };

function check(res: { error: unknown }) {
  if (res.error) throw res.error;
}

/** Edge Function으로 카카오 키워드 검색. 실패(401/502 등)는 오류로 던지고, 할당량 초과(429)는 구분해 던진다. */
export async function searchPlaces(query: string): Promise<Place[]> {
  const { data, error } = await supabase.functions.invoke('kakao-place-search', {
    body: { query },
  });
  if (error) {
    const status = (error as { context?: { status?: unknown } }).context?.status;
    if (status === 429) throw new SearchRateLimitedError();
    throw error;
  }
  return (data as { places?: Place[] } | null)?.places ?? [];
}

export async function fetchLocations(listId: string): Promise<ListLocation[]> {
  const res = await supabase
    .from('list_locations')
    .select('*')
    .eq('list_id', listId)
    .order('place_name');
  check(res);
  return res.data ?? [];
}

/**
 * 내가 속한 모든 그룹의 지점(RLS가 범위를 제한). list_locations에는 families로 가는 직접 FK가 없고
 * (lists로 가는 복합 FK 하나뿐) 그룹 이름은 lists를 거쳐 가져온다.
 */
export async function fetchAllMyLocations(): Promise<MyLocation[]> {
  const res = await supabase
    .from('list_locations')
    .select('*, lists!inner(name, families!inner(name))');
  check(res);
  type Row = ListLocation & { lists: { name: string; families: { name: string } } };
  return ((res.data ?? []) as unknown as Row[]).map(({ lists, ...loc }) => ({
    ...loc,
    list_name: lists.name,
    family_name: lists.families.name,
  }));
}

/**
 * 재실행해도 중복되지 않도록 ON CONFLICT DO NOTHING으로 삽입한다.
 * 같은 목록에 같은 kakao_place_id가 이미 있으면(unique 위반 23505) 목표 상태이므로 성공으로 본다.
 */
export async function insertLocation(row: {
  id: string;
  listId: string;
  familyId: string;
  place: Place;
  radiusM: number;
}): Promise<void> {
  const res = await supabase.from('list_locations').upsert(
    {
      id: row.id,
      list_id: row.listId,
      family_id: row.familyId,
      place_name: row.place.place_name,
      address: row.place.address,
      lat: row.place.lat,
      lng: row.place.lng,
      kakao_place_id: row.place.kakao_place_id,
      radius_m: row.radiusM,
    },
    { onConflict: 'id', ignoreDuplicates: true }
  );
  if ((res.error as { code?: string } | null)?.code === '23505') return;
  check(res);
}

export async function deleteLocation(id: string): Promise<void> {
  check(await supabase.from('list_locations').delete().eq('id', id));
}
