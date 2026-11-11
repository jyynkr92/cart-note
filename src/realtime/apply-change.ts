import type { QueryClient } from '@tanstack/react-query';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { Item } from '@/src/items/item-api';
import { qk } from '@/src/lib/query-keys';

export type RealtimeTable = 'items' | 'lists' | 'list_locations';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function inv(qc: QueryClient, queryKey: readonly unknown[]) {
  void qc.invalidateQueries({ queryKey });
}

/** updated_at이 없는 낙관적 항목은 서버 값보다 오래된 것으로 본다. */
function isStale(cached: Item | undefined, incoming: Item): boolean {
  if (!cached?.updated_at || !incoming.updated_at) return false;
  return Date.parse(incoming.updated_at) < Date.parse(cached.updated_at);
}

function findCached(qc: QueryClient, id: string): { listId: string; item: Item } | undefined {
  for (const [key, data] of qc.getQueriesData<Item[]>({ queryKey: ['items'] })) {
    const item = data?.find((i) => i.id === id);
    if (item) return { listId: key[1] as string, item };
  }
  return undefined;
}

function addTo(qc: QueryClient, listId: string, row: Item) {
  qc.setQueryData<Item[]>(qk.items(listId), (old) => {
    if (!old) return old; // 캐시 없는 목록은 다음 조회 때 서버에서 가져온다.
    return old.some((i) => i.id === row.id) ? old.map((i) => (i.id === row.id ? row : i)) : [...old, row];
  });
}

function applyItem(qc: QueryClient, payload: RealtimePostgresChangesPayload<Row>) {
  if (payload.eventType === 'DELETE') {
    // DELETE 페이로드는 PK만 있고 필터도 못 건다 → 캐시를 건드리지 않고 무효화만.
    inv(qc, ['items']);
    inv(qc, ['lists']);
    return;
  }
  const row = payload.new as Item;
  const cached = findCached(qc, row.id);
  if (!isStale(cached?.item, row)) {
    if (cached && cached.listId !== row.list_id) {
      qc.setQueryData<Item[]>(qk.items(cached.listId), (old) => old?.filter((i) => i.id !== row.id));
    }
    addTo(qc, row.list_id, row);
  }
  inv(qc, qk.lists(row.family_id)); // 홈 카드의 미완료 개수
}

export function applyChange(
  qc: QueryClient,
  table: RealtimeTable,
  payload: RealtimePostgresChangesPayload<Row>
): void {
  const isDelete = payload.eventType === 'DELETE';
  const row = payload.new as Row;
  switch (table) {
    case 'items':
      return applyItem(qc, payload);
    case 'lists':
      return inv(qc, isDelete ? ['lists'] : qk.lists(row.family_id));
    case 'list_locations':
      if (isDelete) {
        inv(qc, ['locations']);
        inv(qc, ['lists']);
      } else {
        inv(qc, qk.locations(row.list_id));
        inv(qc, qk.lists(row.family_id)); // has_location
      }
      inv(qc, qk.allLocations());
  }
}
