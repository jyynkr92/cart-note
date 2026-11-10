import { useMutation, useQuery, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { invalidateWhenIdle, newId, QUEUE_SCOPE } from '@/src/lib/mutation-utils';
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
type ToggleVars = { item: Item };
export type UpdateItemInput = { id: string; name?: string; note?: string | null };
type MoveVars = { fromListId: string; toListId: string; ids: string[] };

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
    onError: (_e: unknown, _v: V, ctx: Ctx | undefined) => {
      rollback(qc, ctx);
      toast.error(spec.error);
    },
    onSettled: (_d: unknown, _e: unknown, v: V) =>
      invalidateWhenIdle(
        qc,
        spec.lists(qc, v).map((id) => qk.items(id))
      ),
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
    run: ({ item }) => {
      const is_done = !item.is_done;
      return api.updateItem(item.id, {
        is_done,
        done_at: is_done ? new Date().toISOString() : null,
      });
    },
    lists: (_qc, v) => [v.item.list_id],
    apply: (qc, { item }) => {
      const is_done = !item.is_done;
      const done_at = is_done ? new Date().toISOString() : null;
      patchList(qc, item.list_id, (old) =>
        old.map((i) => (i.id === item.id ? { ...i, is_done, done_at } : i))
      );
    },
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

  define<{ listId: string }>(qc, {
    key: mk.clearDone,
    run: (v) => api.clearDoneItems(v.listId),
    lists: (_qc, v) => [v.listId],
    apply: (qc, v) => patchList(qc, v.listId, (old) => old.filter((i) => !i.is_done)),
    error: '완료 항목을 지우지 못했어요',
  });

  define<{ listId: string }>(qc, {
    key: mk.clearList,
    run: (v) => api.clearListItems(v.listId),
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
  const { mutate, mutateAsync } = m;
  return useMemo(() => {
    const prepare = (input: AddItemInput): AddItemVars | null => {
      const name = normalizeName(input.name);
      if (!name) return null; // 공백뿐인 이름은 저장하지 않는다
      return { ...input, name, id: newId(), createdAt: new Date().toISOString() };
    };
    return {
      ...m,
      mutate: (input: AddItemInput) => {
        const vars = prepare(input);
        if (vars) mutate(vars);
      },
      mutateAsync: async (input: AddItemInput) => {
        const vars = prepare(input);
        if (vars) await mutateAsync(vars);
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, mutate, mutateAsync]);
}

export function useToggleItem() {
  return useMutation<void, Error, ToggleVars, Ctx>({ mutationKey: mk.toggleItem });
}

export function useUpdateItem() {
  const m = useMutation<void, Error, UpdateItemInput, Ctx>({ mutationKey: mk.updateItem });
  const { mutate, mutateAsync } = m;
  return useMemo(() => {
    const prepare = (input: UpdateItemInput): UpdateItemInput | null => {
      const out: UpdateItemInput = { id: input.id };
      if (input.name !== undefined) {
        const name = normalizeName(input.name);
        if (!name) return null; // 이름을 공백으로 바꾸는 수정은 무시
        out.name = name;
      }
      if (input.note !== undefined)
        out.note = input.note === null ? null : (normalizeName(input.note) ?? null);
      return out;
    };
    return {
      ...m,
      mutate: (input: UpdateItemInput) => {
        const vars = prepare(input);
        if (vars) mutate(vars);
      },
      mutateAsync: async (input: UpdateItemInput) => {
        const vars = prepare(input);
        if (vars) await mutateAsync(vars);
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, mutate, mutateAsync]);
}

export function useDeleteItems() {
  return useMutation<void, Error, { listId: string; ids: string[] }, Ctx>({
    mutationKey: mk.deleteItems,
  });
}

export function useClearDone() {
  return useMutation<void, Error, { listId: string }, Ctx>({ mutationKey: mk.clearDone });
}

export function useClearList() {
  return useMutation<void, Error, { listId: string }, Ctx>({ mutationKey: mk.clearList });
}

export function useMoveItems() {
  return useMutation<void, Error, MoveVars, Ctx>({ mutationKey: mk.moveItems });
}
