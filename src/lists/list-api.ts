import { supabase } from '@/src/lib/supabase';
import type { Database } from '@/src/lib/database.types';

type ListRow = Database['public']['Tables']['lists']['Row'];
/** 표시용 파생 값은 조회 시에만 채워진다(낙관적으로 만든 목록에는 없을 수 있다). */
export type List = ListRow & { unfinished_count?: number; has_location?: boolean };
export type ListKind = List['kind'];

function check(res: { error: unknown }) {
  if (res.error) throw res.error;
}

export async function fetchLists(familyId: string): Promise<List[]> {
  const res = await supabase
    .from('lists')
    .select('*, items(count), list_locations(count)')
    .eq('family_id', familyId)
    .eq('items.is_done', false)
    .order('sort_order')
    .order('created_at');
  check(res);
  type Row = ListRow & { items: { count: number }[] | null; list_locations: { count: number }[] | null };
  return ((res.data ?? []) as unknown as Row[]).map(({ items, list_locations, ...list }) => ({
    ...list,
    unfinished_count: items?.[0]?.count ?? 0,
    has_location: (list_locations?.[0]?.count ?? 0) > 0,
  }));
}

export async function insertList(row: {
  id: string;
  familyId: string;
  name: string;
  kind: ListKind;
}): Promise<void> {
  check(
    await supabase
      .from('lists')
      .upsert(
        { id: row.id, family_id: row.familyId, name: row.name, kind: row.kind },
        { onConflict: 'id', ignoreDuplicates: true }
      )
  );
}

export async function renameList(id: string, name: string): Promise<void> {
  check(await supabase.from('lists').update({ name }).eq('id', id));
}

/** inbox 목록은 DB 트리거가 거부한다. 오류는 그대로 던진다. */
export async function deleteList(id: string): Promise<void> {
  check(await supabase.from('lists').delete().eq('id', id));
}
