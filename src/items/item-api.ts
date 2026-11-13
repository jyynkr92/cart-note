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

/** `.in('id', …)`은 URL 쿼리로 가므로 길이 제한을 넘지 않게 100개씩 나눠 순서대로 보낸다. 첫 오류에서 멈춘다. */
export const ID_BATCH_SIZE = 100;

async function inBatches(ids: string[], run: (batch: string[]) => PromiseLike<{ error: unknown }>) {
  for (let i = 0; i < ids.length; i += ID_BATCH_SIZE) {
    check(await run(ids.slice(i, i + ID_BATCH_SIZE)));
  }
}

export async function deleteItems(ids: string[]): Promise<void> {
  await inBatches(ids, (batch) => supabase.from('items').delete().in('id', batch));
}

/**
 * 완료 항목 지우기 재실행: 누를 때 보이던 id 중 아직 그 목록에 있고 완료 상태인 것만 지운다
 * (그 사이 다른 목록으로 옮겨졌거나 다시 미완료가 된 항목은 남긴다).
 */
export async function clearDoneItems(listId: string, ids: string[]): Promise<void> {
  await inBatches(ids, (batch) =>
    supabase.from('items').delete().in('id', batch).eq('list_id', listId).eq('is_done', true)
  );
}

/** 목록 비우기 재실행: 누를 때 보이던 id 중 아직 그 목록에 있는 것만 지운다. */
export async function clearListItems(listId: string, ids: string[]): Promise<void> {
  await inBatches(ids, (batch) =>
    supabase.from('items').delete().in('id', batch).eq('list_id', listId)
  );
}

export async function moveItems(toListId: string, ids: string[]): Promise<void> {
  await inBatches(ids, (batch) =>
    supabase.from('items').update({ list_id: toListId }).in('id', batch)
  );
}
