import { supabase } from '@/src/lib/supabase';
import type { Database } from '@/src/lib/database.types';

export type Item = Database['public']['Tables']['items']['Row'];

/** UPDATE 권한이 있는 컬럼만 허용한다(그 외 컬럼을 보내면 42501). */
export type ItemPatch = Partial<
  Pick<Item, 'name' | 'note' | 'is_done' | 'done_at' | 'sort_order' | 'list_id'>
>;

function check(res: { error: unknown }) {
  if (res.error) throw res.error;
}

export async function fetchItems(listId: string): Promise<Item[]> {
  const res = await supabase.from('items').select('*').eq('list_id', listId).order('created_at');
  check(res);
  return res.data ?? [];
}

/** 재실행해도 중복되지 않도록 ON CONFLICT DO NOTHING으로 삽입한다(merge-upsert는 42501). */
export async function insertItem(row: {
  id: string;
  listId: string;
  familyId: string;
  name: string;
}): Promise<void> {
  check(
    await supabase
      .from('items')
      .upsert(
        { id: row.id, list_id: row.listId, family_id: row.familyId, name: row.name },
        { onConflict: 'id', ignoreDuplicates: true }
      )
  );
}

export async function updateItem(id: string, patch: ItemPatch): Promise<void> {
  check(await supabase.from('items').update(patch).eq('id', id));
}

export async function deleteItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  check(await supabase.from('items').delete().in('id', ids));
}

export async function moveItems(toListId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  check(await supabase.from('items').update({ list_id: toListId }).in('id', ids));
}
