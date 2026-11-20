import { supabase } from '@/src/lib/supabase';

/** 목록의 미완료 항목 수(서버). 실패는 오류로 던진다. */
export async function fetchOpenCount(listId: string): Promise<number> {
  const { count, error } = await supabase
    .from('items')
    .select('id', { count: 'exact', head: true })
    .eq('list_id', listId)
    .eq('is_done', false);
  if (error) throw error;
  return count ?? 0;
}

/** 여러 목록의 미완료 항목 수를 한 번에 조회한다(진입 시 서버 조회 실패 대비 스냅샷용). */
export async function fetchOpenCounts(listIds: string[]): Promise<Record<string, number>> {
  if (listIds.length === 0) return {};
  const res = await supabase
    .from('lists')
    .select('id, items(count)')
    .in('id', listIds)
    .eq('items.is_done', false);
  if (res.error) throw res.error;
  type Row = { id: string; items: { count: number }[] | null };
  const out: Record<string, number> = {};
  for (const row of (res.data ?? []) as unknown as Row[]) out[row.id] = row.items?.[0]?.count ?? 0;
  return out;
}
