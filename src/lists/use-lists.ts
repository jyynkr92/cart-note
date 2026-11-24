import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  invalidateWhenIdle,
  newId,
  QUEUE_SCOPE,
  sessionGuarded,
  withPrepare,
} from '@/src/lib/mutation-utils';
import { mk, qk } from '@/src/lib/query-keys';
import { normalizeName } from '@/src/lib/text';
import { toast } from '@/src/lib/toast';
import * as api from './list-api';
import type { List, ListKind } from './list-api';

export function useLists(familyId: string | null | undefined) {
  return useQuery({
    queryKey: qk.lists(familyId ?? ''),
    queryFn: () => api.fetchLists(familyId!),
    enabled: !!familyId,
  });
}

export type CreateListInput = { familyId: string; name: string; kind?: Exclude<ListKind, 'inbox'> };
type CreateListVars = {
  id: string;
  familyId: string;
  name: string;
  kind: ListKind;
  createdAt: string;
  /** 누를 때 캐시 기준 맨 아래(nextSortOrder). 이 값이 없던 버전에서 영속화된 변수에는 없을 수 있다. */
  sortOrder?: number;
};
type RenameVars = { id: string; familyId: string; name: string };
type DeleteVars = { id: string; familyId: string };
export type ReorderVars = { familyId: string; ids: string[] };
type Ctx = { prev: List[] | undefined };

/** 새 목록이 맨 아래에 오도록: inbox를 뺀 최대 sort_order + 1, 없으면 1. */
export function nextSortOrder(lists: List[]): number {
  let max = 0;
  for (const l of lists) if (l.kind !== 'inbox' && l.sort_order > max) max = l.sort_order;
  return max + 1;
}

/**
 * reorder_lists RPC와 같은 규칙으로 캐시의 sort_order를 바꾼다(동기화 뒤 재조회해도 순서가 그대로이도록).
 * ids 중 캐시에 있는 inbox가 아닌 목록을 첫 등장 순서대로 1..k, 나머지 inbox가 아닌 목록은
 * (sort_order, created_at, id) 순서로 그 뒤에 붙인다. inbox는 건드리지 않는다.
 */
function applyReorder(old: List[], ids: string[]): List[] {
  const movable = old.filter((l) => l.kind !== 'inbox');
  const byId = new Map(movable.map((l) => [l.id, l]));
  const given: List[] = [];
  for (const id of ids) {
    const l = byId.get(id);
    if (l && !given.includes(l)) given.push(l);
  }
  const rest = movable
    .filter((l) => !given.includes(l))
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        Date.parse(a.created_at) - Date.parse(b.created_at) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  const order = new Map([...given, ...rest].map((l, i) => [l.id, i + 1]));
  return old.map((l) => {
    const n = order.get(l.id);
    return n === undefined || n === l.sort_order ? l : { ...l, sort_order: n };
  });
}

function define<V extends { familyId: string }>(
  qc: QueryClient,
  spec: {
    key: readonly unknown[];
    run: (v: V) => Promise<void>;
    apply: (old: List[], v: V) => List[];
    error: string;
    after?: (qc: QueryClient, v: V) => void;
  }
) {
  qc.setMutationDefaults(spec.key, {
    scope: QUEUE_SCOPE,
    mutationFn: sessionGuarded(spec.run),
    onMutate: async (v: V): Promise<Ctx> => {
      const key = qk.lists(v.familyId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<List[]>(key);
      qc.setQueryData<List[]>(key, (old) => (old ? spec.apply(old, v) : old));
      return { prev };
    },
    onError: (_e: unknown, v: V, ctx: Ctx | undefined) => {
      if (ctx?.prev) qc.setQueryData(qk.lists(v.familyId), ctx.prev);
      void qc.invalidateQueries({ queryKey: qk.lists(v.familyId) });
      toast.error(spec.error);
    },
    onSuccess: (_d: unknown, v: V) => spec.after?.(qc, v),
    onSettled: () => invalidateWhenIdle(qc),
  });
}

export function registerListMutations(qc: QueryClient) {
  define<CreateListVars>(qc, {
    key: mk.createList,
    run: (v) => api.insertList(v),
    apply: (old, v) =>
      old.some((l) => l.id === v.id)
        ? old
        : [
            ...old,
            {
              id: v.id,
              family_id: v.familyId,
              name: v.name,
              kind: v.kind,
              sort_order: v.sortOrder ?? 0,
              created_at: v.createdAt,
            },
          ],
    error: '목록을 만들지 못했어요',
  });

  define<RenameVars>(qc, {
    key: mk.renameList,
    run: (v) => api.renameList(v.id, v.name),
    apply: (old, v) => old.map((l) => (l.id === v.id ? { ...l, name: v.name } : l)),
    error: '이름을 바꾸지 못했어요',
  });

  // inbox 삭제는 DB가 거부한다(UI에서는 제공하지 않음). 실패하면 롤백하고 안내한다.
  define<DeleteVars>(qc, {
    key: mk.deleteList,
    run: (v) => api.deleteList(v.id),
    apply: (old, v) => old.filter((l) => l.id !== v.id),
    after: (qc, v) => qc.removeQueries({ queryKey: qk.items(v.id) }),
    error: '목록을 삭제하지 못했어요',
  });

  // 서버(RPC)가 재생 시점에 그 그룹의 목록인지 다시 확인하고, 그사이 지워진 id는 건너뛴다.
  define<ReorderVars>(qc, {
    key: mk.reorderLists,
    run: (v) => api.reorderLists(v.familyId, v.ids),
    apply: (old, v) => applyReorder(old, v.ids),
    error: '순서를 저장하지 못했어요',
  });
}

export function useCreateList() {
  const qc = useQueryClient();
  const m = useMutation<void, Error, CreateListVars, Ctx>({ mutationKey: mk.createList });
  return withPrepare(m, (input: CreateListInput): CreateListVars | null => {
    const name = normalizeName(input.name);
    if (!name) return null;
    return {
      id: newId(),
      familyId: input.familyId,
      name,
      kind: input.kind ?? 'store',
      createdAt: new Date().toISOString(),
      sortOrder: nextSortOrder(qc.getQueryData<List[]>(qk.lists(input.familyId)) ?? []),
    };
  });
}

export function useRenameList() {
  const m = useMutation<void, Error, RenameVars, Ctx>({ mutationKey: mk.renameList });
  return withPrepare(m, (input: RenameVars): RenameVars | null => {
    const name = normalizeName(input.name);
    return name ? { ...input, name } : null;
  });
}

export function useDeleteList() {
  return useMutation<void, Error, DeleteVars, Ctx>({ mutationKey: mk.deleteList });
}

export function useReorderLists() {
  const m = useMutation<void, Error, ReorderVars, Ctx>({ mutationKey: mk.reorderLists });
  return withPrepare(m, (input: ReorderVars): ReorderVars | null =>
    input.ids.length ? { familyId: input.familyId, ids: [...input.ids] } : null
  );
}
