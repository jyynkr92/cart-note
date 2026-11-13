import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { invalidateWhenIdle, newId, QUEUE_SCOPE, withPrepare } from '@/src/lib/mutation-utils';
import { mk, qk } from '@/src/lib/query-keys';
import { normalizeName } from '@/src/lib/text';
import { toast } from '@/src/lib/toast';
import * as api from './item-api';
import type { Item } from './item-api';

export function useItems(listId: string | null | undefined) {
  return useQuery({
    queryKey: qk.items(listId ?? ''),
    queryFn: () => api.fetchItems(listId!),
    enabled: !!listId,
  });
}

// ---- 변수 타입(모두 직렬화 가능해야 한다: 오프라인 큐로 영속화됨) ----
export type AddItemInput = { listId: string; familyId: string; name: string };
type AddItemVars = AddItemInput & { id: string; createdAt: string };
type ToggleVars = { item: Item; isDone: boolean; doneAt: string | null };
export type UpdateItemInput = { id: string; name?: string; note?: string | null };
type MoveVars = { fromListId: string; toListId: string; ids: string[] };
/** 비우기: 누를 때 보이던 항목 id를 담는다. 재실행 때 list_id로 다시 고르면 그 사이 남이 넣은 항목까지 지운다. */
type ClearVars = { listId: string; ids: string[] };

type Ctx = { prev: [string, Item[] | undefined][] };

// ---- 낙관적 캐시 헬퍼 ----
async function snapshot(qc: QueryClient, listIds: string[]): Promise<Ctx> {
  await Promise.all(listIds.map((id) => qc.cancelQueries({ queryKey: qk.items(id) })));
  return { prev: listIds.map((id) => [id, qc.getQueryData<Item[]>(qk.items(id))]) };
}

function patchList(qc: QueryClient, listId: string, fn: (old: Item[]) => Item[]) {
  qc.setQueryData<Item[]>(qk.items(listId), (old) => (old ? fn(old) : old));
}

function rollback(qc: QueryClient, ctx: Ctx | undefined) {
  for (const [id, data] of ctx?.prev ?? []) {
    if (data) qc.setQueryData(qk.items(id), data);
  }
}

function listIdOf(qc: QueryClient, itemId: string): string | undefined {
  for (const [key, data] of qc.getQueriesData<Item[]>({ queryKey: ['items'] })) {
    if (data?.some((i) => i.id === itemId)) return key[1] as string;
  }
  return undefined;
}

type Spec<V> = {
  key: readonly unknown[];
  run: (v: V) => Promise<void>;
  /** 영향받는 목록 id (낙관적 반영 + 무효화 대상) */
  lists: (qc: QueryClient, v: V) => string[];
  apply: (qc: QueryClient, v: V) => void;
  error: string;
};

// 참고: 실행 중(아직 일시정지되지 않은) mutation은 앱이 강제 종료되면 유실된다.
// 낙관적 값은 다음 실행 때 서버 상태로 다시 맞춰진다(마지막 쓰기 우선 정책으로 수용).
function define<V>(qc: QueryClient, spec: Spec<V>) {
  qc.setMutationDefaults(spec.key, {
    scope: QUEUE_SCOPE,
    mutationFn: spec.run,
    onMutate: async (v: V) => {
      const ctx = await snapshot(qc, spec.lists(qc, v));
      spec.apply(qc, v);
      return ctx;
    },
    // 재시작 후 재개된 mutation은 context가 없다 → 롤백 대신 무효화로 서버 값에 맞춘다.
    onError: (_e: unknown, v: V, ctx: Ctx | undefined) => {
      rollback(qc, ctx);
      // 실패한 mutation이 건드린 목록은 큐 상태와 무관하게 항상 서버 값으로 맞춘다.
      for (const id of spec.lists(qc, v)) void qc.invalidateQueries({ queryKey: qk.items(id) });
      toast.error(spec.error);
    },
    onSettled: () => invalidateWhenIdle(qc),
  });
}

/** QueryClient에 항목 mutation 기본값을 등록한다. (영속화된 mutation 재개에 필요) */
export function registerItemMutations(qc: QueryClient) {
  define<AddItemVars>(qc, {
    key: mk.addItem,
    run: (v) => api.insertItem({ id: v.id, listId: v.listId, familyId: v.familyId, name: v.name }),
    lists: (_qc, v) => [v.listId],
    apply: (qc, v) =>
      patchList(qc, v.listId, (old) =>
        old.some((i) => i.id === v.id)
          ? old
          : [
              ...old,
              {
                id: v.id,
                list_id: v.listId,
                family_id: v.familyId,
                name: v.name,
                note: null,
                is_done: false,
                done_at: null,
                sort_order: 0,
                created_at: v.createdAt,
                updated_at: v.createdAt,
                created_by: null,
              },
            ]
      ),
    error: '항목을 추가하지 못했어요',
  });

  define<ToggleVars>(qc, {
    key: mk.toggleItem,
    run: ({ item, isDone, doneAt }) => api.updateItem(item.id, { is_done: isDone, done_at: doneAt }),
    lists: (_qc, v) => [v.item.list_id],
    apply: (qc, { item, isDone, doneAt }) =>
      patchList(qc, item.list_id, (old) =>
        old.map((i) => (i.id === item.id ? { ...i, is_done: isDone, done_at: doneAt } : i))
      ),
    error: '변경하지 못했어요',
  });

  define<UpdateItemInput>(qc, {
    key: mk.updateItem,
    run: ({ id, ...patch }) => api.updateItem(id, patch),
    lists: (qc, v) => {
      const id = listIdOf(qc, v.id);
      return id ? [id] : [];
    },
    apply: (qc, { id, ...patch }) => {
      const listId = listIdOf(qc, id);
      if (listId)
        patchList(qc, listId, (old) => old.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    },
    error: '수정하지 못했어요',
  });

  define<{ listId: string; ids: string[] }>(qc, {
    key: mk.deleteItems,
    run: (v) => api.deleteItems(v.ids),
    lists: (_qc, v) => [v.listId],
    apply: (qc, v) => patchList(qc, v.listId, (old) => old.filter((i) => !v.ids.includes(i.id))),
    error: '삭제하지 못했어요',
  });

  define<ClearVars>(qc, {
    key: mk.clearDone,
    // ids가 없는(이전 버전에서 영속화된) 변수는 무엇을 지울지 알 수 없으므로 아무것도 지우지 않는다.
    run: (v) => api.deleteItems(v.ids ?? []),
    lists: (_qc, v) => [v.listId],
    apply: (qc, v) => patchList(qc, v.listId, (old) => old.filter((i) => !i.is_done)),
    error: '완료 항목을 지우지 못했어요',
  });

  define<ClearVars>(qc, {
    key: mk.clearList,
    run: (v) => api.deleteItems(v.ids ?? []),
    lists: (_qc, v) => [v.listId],
    apply: (qc, v) => patchList(qc, v.listId, () => []),
    error: '목록을 비우지 못했어요',
  });

  define<MoveVars>(qc, {
    key: mk.moveItems,
    run: (v) => api.moveItems(v.toListId, v.ids),
    lists: (_qc, v) => [v.fromListId, v.toListId],
    apply: (qc, v) => {
      const from = qc.getQueryData<Item[]>(qk.items(v.fromListId)) ?? [];
      const moved = from
        .filter((i) => v.ids.includes(i.id))
        .map((i) => ({ ...i, list_id: v.toListId }));
      patchList(qc, v.fromListId, (old) => old.filter((i) => !v.ids.includes(i.id)));
      patchList(qc, v.toListId, (old) => [...old.filter((i) => !v.ids.includes(i.id)), ...moved]);
    },
    error: '이동하지 못했어요',
  });
}

// ---- 훅 ----
export function useAddItem() {
  const m = useMutation<void, Error, AddItemVars, Ctx>({ mutationKey: mk.addItem });
  return withPrepare(m, (input: AddItemInput): AddItemVars | null => {
    const name = normalizeName(input.name);
    if (!name) return null; // 공백뿐인 이름은 저장하지 않는다
    return { ...input, name, id: newId(), createdAt: new Date().toISOString() };
  });
}

export function useToggleItem() {
  const m = useMutation<void, Error, ToggleVars, Ctx>({ mutationKey: mk.toggleItem });
  return withPrepare(m, ({ item }: { item: Item }): ToggleVars => {
    const isDone = !item.is_done;
    // 낙관적 값과 서버 값이 같도록 시각을 한 번만 계산해 변수에 담는다.
    return { item, isDone, doneAt: isDone ? new Date().toISOString() : null };
  });
}

export function useUpdateItem() {
  const m = useMutation<void, Error, UpdateItemInput, Ctx>({ mutationKey: mk.updateItem });
  return withPrepare(m, (input: UpdateItemInput): UpdateItemInput | null => {
    const out: UpdateItemInput = { id: input.id };
    if (input.name !== undefined) {
      const name = normalizeName(input.name);
      if (!name) return null; // 이름을 공백으로 바꾸는 수정은 무시
      out.name = name;
    }
    if (input.note !== undefined)
      out.note = input.note === null ? null : (normalizeName(input.note) ?? null);
    return out;
  });
}

export function useDeleteItems() {
  return useMutation<void, Error, { listId: string; ids: string[] }, Ctx>({
    mutationKey: mk.deleteItems,
  });
}

function cachedIds(qc: QueryClient, listId: string, keep: (i: Item) => boolean): string[] {
  return (qc.getQueryData<Item[]>(qk.items(listId)) ?? []).filter(keep).map((i) => i.id);
}

export function useClearDone() {
  const qc = useQueryClient();
  const m = useMutation<void, Error, ClearVars, Ctx>({ mutationKey: mk.clearDone });
  return withPrepare(m, ({ listId }: { listId: string }): ClearVars | null => {
    const ids = cachedIds(qc, listId, (i) => i.is_done);
    return ids.length ? { listId, ids } : null;
  });
}

export function useClearList() {
  const qc = useQueryClient();
  const m = useMutation<void, Error, ClearVars, Ctx>({ mutationKey: mk.clearList });
  return withPrepare(m, ({ listId }: { listId: string }): ClearVars | null => {
    const ids = cachedIds(qc, listId, () => true);
    return ids.length ? { listId, ids } : null;
  });
}

export function useMoveItems() {
  return useMutation<void, Error, MoveVars, Ctx>({ mutationKey: mk.moveItems });
}
