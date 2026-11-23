import { useMutation, useQuery, type QueryClient } from '@tanstack/react-query';
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
};
type RenameVars = { id: string; familyId: string; name: string };
type DeleteVars = { id: string; familyId: string };
type Ctx = { prev: List[] | undefined };

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
              sort_order: 0,
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
}

export function useCreateList() {
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
