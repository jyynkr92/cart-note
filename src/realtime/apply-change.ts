import { timeoutManager, type QueryClient } from '@tanstack/react-query';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { Item } from '@/src/items/item-api';
import { mk, qk } from '@/src/lib/query-keys';

export type RealtimeTable = 'items' | 'lists' | 'list_locations';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Realtime이 일으키는 무효화는 진행 중인 조회를 취소하고 다시 시작하지 않는다(이벤트 폭주 시 재조회 연쇄 방지). */
export const REALTIME_INVALIDATE = { cancelRefetch: false } as const;

function inv(qc: QueryClient, queryKey: readonly unknown[]) {
  void qc.invalidateQueries({ queryKey }, REALTIME_INVALIDATE);
}

/**
 * 캐시에 없는 항목 DELETE는 필터 없이 모든 그룹에서 오므로, 홈 개수 갱신을 1초 트레일링으로 묶는다.
 * 이벤트가 계속 와도 첫 이벤트 후 최대 3초 안에는 한 번 발화한다.
 */
export const UNCACHED_DELETE_DEBOUNCE_MS = 1000;
export const UNCACHED_DELETE_MAX_WAIT_MS = 3000;
type Pending = { timer: ReturnType<typeof timeoutManager.setTimeout>; firstAt: number };
const pendingCounts = new WeakMap<QueryClient, Pending>();

function refreshCountsSoon(qc: QueryClient) {
  const now = Date.now();
  const prev = pendingCounts.get(qc);
  if (prev) timeoutManager.clearTimeout(prev.timer);
  const firstAt = prev?.firstAt ?? now;
  const delay = Math.max(
    0,
    Math.min(UNCACHED_DELETE_DEBOUNCE_MS, firstAt + UNCACHED_DELETE_MAX_WAIT_MS - now)
  );
  pendingCounts.set(qc, {
    firstAt,
    timer: timeoutManager.setTimeout(() => {
      pendingCounts.delete(qc);
      // 발화 시점에 큐가 바쁘면 건너뛴다(큐가 비면 invalidateWhenIdle이 맞춘다).
      if (!isBusy(qc)) inv(qc, ['lists']);
    }, delay),
  });
}

/** 예약된 Realtime 후속 작업(개수 갱신)을 취소한다. 로그아웃/캐시 삭제와 구독 해제 때 부른다. */
export function cancelPendingRealtimeWork(qc: QueryClient): void {
  const prev = pendingCounts.get(qc);
  if (!prev) return;
  timeoutManager.clearTimeout(prev.timer);
  pendingCounts.delete(qc);
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

/** prefixes 아래 캐시된 배열 중 하나라도 id 행을 갖고 있는지. */
function isCachedId(qc: QueryClient, prefixes: string[], id: unknown): boolean {
  if (typeof id !== 'string' || !id) return false;
  return prefixes.some((p) =>
    qc
      .getQueriesData<Row[]>({ queryKey: [p] })
      .some(([, data]) => Array.isArray(data) && data.some((r) => r?.id === id))
  );
}

function isFetchingAny(qc: QueryClient, prefixes: string[]): boolean {
  return prefixes.some((p) => qc.isFetching({ queryKey: [p] }) > 0);
}

/** DELETE 대상이 이 기기 캐시에 있는 행인지. 없으면 다른 그룹의 삭제이거나 이미 반영된 삭제다. */
const DELETE_CACHES: Record<RealtimeTable, string[]> = {
  items: ['items'],
  lists: ['lists'],
  list_locations: ['locations', 'allLocations'],
};

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
  // DELETE는 family_id로 필터링할 수 없어 모든 그룹의 삭제가 온다 → 캐시에 없는 행은 무시한다(무효화 폭주 방지).
  // 단, 그 캐시를 조회하는 중이면 응답에 삭제된 행이 섞일 수 있으므로 무시하지 않는다.
  if (isDelete) {
    const prefixes = DELETE_CACHES[table];
    const oldId = (payload.old as Row | null)?.id;
    const relevant =
      isCachedId(qc, prefixes, oldId) ||
      (typeof oldId === 'string' && !!oldId && isFetchingAny(qc, prefixes));
    if (!relevant) {
      // 다른 목록(홈 카드)의 미완료 개수는 바뀌었을 수 있다. 큐가 바쁘면 invalidateWhenIdle이 맞춘다.
      if (table === 'items' && !isBusy(qc)) refreshCountsSoon(qc);
      return;
    }
  }
  const row = payload.new as Row;
  const busy = isBusy(qc);
  switch (table) {
    case 'items':
      return applyItem(qc, payload);
    case 'lists':
      if (busy) return;
      return inv(qc, isDelete ? ['lists'] : qk.lists(row.family_id));
    case 'list_locations':
      // 큐가 비어 있을 때만 목록별 캐시를 건드린다(비면 invalidateWhenIdle이 맞춘다).
      // allLocations는 낙관적 값이 없는 읽기 전용 캐시라 항상 무효화한다.
      if (!busy) {
        if (isDelete) {
          inv(qc, ['locations']);
          inv(qc, ['lists']);
        } else {
          inv(qc, qk.locations(row.list_id));
          inv(qc, qk.lists(row.family_id)); // has_location
        }
      }
      inv(qc, qk.allLocations());
  }
}
