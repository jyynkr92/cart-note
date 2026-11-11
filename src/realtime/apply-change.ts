import type { QueryClient } from '@tanstack/react-query';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { Item } from '@/src/items/item-api';
import { mk, qk } from '@/src/lib/query-keys';

export type RealtimeTable = 'items' | 'lists' | 'list_locations';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function inv(qc: QueryClient, queryKey: readonly unknown[]) {
  void qc.invalidateQueries({ queryKey });
}

/** 대기 중인 쓰기 mutation이 있으면 낙관적 값을 보호한다(큐가 비면 invalidateWhenIdle이 items/lists를 다시 맞춘다). */
function isBusy(qc: QueryClient): boolean {
  return qc.isMutating({ mutationKey: mk.all }) > 0;
}

/** updated_at이 없는 낙관적 항목은 서버 값보다 오래된 것으로 본다. */
function isStale(cached: Item | undefined, incoming: Item): boolean {
  if (!cached?.updated_at || !incoming.updated_at) return false;
  // ms 단위 동률이나 NaN(파싱 실패)이면 stale이 아니다 → 적용(마지막 쓰기 우선).
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
    if (old.some((i) => i.id === row.id)) return old.map((i) => (i.id === row.id ? row : i));
    // fetchItems와 같은 created_at 순서를 유지한다.
    const at = old.findIndex((i) => i.created_at > row.created_at);
    return at === -1 ? [...old, row] : [...old.slice(0, at), row, ...old.slice(at)];
  });
}

function applyItem(qc: QueryClient, payload: RealtimePostgresChangesPayload<Row>) {
  if (isBusy(qc)) return;
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
      qc.setQueryData<Item[]>(qk.items(cached.listId), (old) =>
        old?.filter((i) => i.id !== row.id)
      );
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
  const busy = isBusy(qc);
  switch (table) {
    case 'items':
      return applyItem(qc, payload);
    case 'lists':
      if (busy) return;
      return inv(qc, isDelete ? ['lists'] : qk.lists(row.family_id));
    case 'list_locations':
      // locations는 invalidateWhenIdle이 다루지 않으므로 항상 무효화한다.
      if (isDelete) {
        inv(qc, ['locations']);
        if (!busy) inv(qc, ['lists']);
      } else {
        inv(qc, qk.locations(row.list_id));
        if (!busy) inv(qc, qk.lists(row.family_id)); // has_location
      }
      inv(qc, qk.allLocations());
  }
}
