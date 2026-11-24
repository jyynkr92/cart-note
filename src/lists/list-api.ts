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
  /** 이 값이 없던 버전에서 영속화된 변수는 DB 기본값을 쓴다. */
  sortOrder?: number;
}): Promise<void> {
  check(
    await supabase
      .from('lists')
      .upsert(
        {
          id: row.id,
          family_id: row.familyId,
          name: row.name,
          kind: row.kind,
          ...(row.sortOrder === undefined ? {} : { sort_order: row.sortOrder }),
        },
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

/**
 * 목록 순서를 한 번에 저장한다(RPC). ids 순서대로 inbox가 아닌 목록에 1..k를 쓰고, 모르는·다른 그룹·지워진·inbox id는
 * 건너뛰며, ids에 없는 목록은 기존 (sort_order, created_at, id) 순서로 뒤에 붙인다.
 */
export async function reorderLists(familyId: string, ids: string[]): Promise<void> {
  check(await supabase.rpc('reorder_lists', { p_family_id: familyId, p_ids: ids }));
}
