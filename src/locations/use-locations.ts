import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { invalidateWhenIdle, newId, QUEUE_SCOPE } from '@/src/lib/mutation-utils';
import { mk, qk } from '@/src/lib/query-keys';
import { toast } from '@/src/lib/toast';
import * as api from './location-api';
import type { ListLocation, Place } from './location-api';

export const DEFAULT_RADIUS_M = 300;

export function useLocations(listId: string | null | undefined) {
  return useQuery({
    queryKey: qk.locations(listId ?? ''),
    queryFn: () => api.fetchLocations(listId!),
    enabled: !!listId,
  });
}

export type AddLocationInput = { listId: string; familyId: string; place: Place };
type AddVars = AddLocationInput & { id: string; radiusM: number };
type DeleteVars = { id: string; listId: string; familyId: string };
type Ctx = { prev: ListLocation[] | undefined };

function afterSuccess(qc: QueryClient, listId: string, familyId: string) {
  // 홈 카드의 📍 표시는 lists 쿼리의 지점 개수에서 온다.
  void qc.invalidateQueries({ queryKey: qk.locations(listId) });
  void qc.invalidateQueries({ queryKey: qk.allLocations() });
  void qc.invalidateQueries({ queryKey: qk.lists(familyId) });
}

function define<V extends { listId: string; familyId: string }>(
  qc: QueryClient,
  spec: {
    key: readonly unknown[];
    run: (v: V) => Promise<void>;
    apply: (old: ListLocation[], v: V) => ListLocation[];
    error: string;
  }
) {
  qc.setMutationDefaults(spec.key, {
    scope: QUEUE_SCOPE,
    mutationFn: spec.run,
    onMutate: async (v: V): Promise<Ctx> => {
      const key = qk.locations(v.listId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ListLocation[]>(key);
      qc.setQueryData<ListLocation[]>(key, (old) => (old ? spec.apply(old, v) : old));
      return { prev };
    },
    onError: (_e: unknown, v: V, ctx: Ctx | undefined) => {
      if (ctx?.prev) qc.setQueryData(qk.locations(v.listId), ctx.prev);
      void qc.invalidateQueries({ queryKey: qk.locations(v.listId) });
      toast.error(spec.error);
    },
    onSuccess: (_d: unknown, v: V) => afterSuccess(qc, v.listId, v.familyId),
    onSettled: () => invalidateWhenIdle(qc),
  });
}

/** QueryClient에 지점 mutation 기본값을 등록한다. (영속화된 mutation 재개에 필요) */
export function registerLocationMutations(qc: QueryClient) {
  define<AddVars>(qc, {
    key: mk.addLocation,
    run: (v) => api.insertLocation(v),
    apply: (old, v) =>
      old.some((l) => l.id === v.id)
        ? old
        : [
            ...old,
            {
              id: v.id,
              list_id: v.listId,
              family_id: v.familyId,
              place_name: v.place.place_name,
              address: v.place.address,
              lat: v.place.lat,
              lng: v.place.lng,
              kakao_place_id: v.place.kakao_place_id,
              radius_m: v.radiusM,
            },
          ],
    error: '지점을 추가하지 못했어요',
  });

  define<DeleteVars>(qc, {
    key: mk.deleteLocation,
    run: (v) => api.deleteLocation(v.id),
    apply: (old, v) => old.filter((l) => l.id !== v.id),
    error: '지점을 삭제하지 못했어요',
  });
}

export function useAddLocation() {
  const qc = useQueryClient();
  const m = useMutation<void, Error, AddVars, Ctx>({ mutationKey: mk.addLocation });
  return {
    ...m,
    // 같은 목록에는 같은 kakao_place_id를 두 번 등록하지 않는다.
    mutate: (input: AddLocationInput) => {
      const existing = qc.getQueryData<ListLocation[]>(qk.locations(input.listId));
      if (existing?.some((l) => l.kakao_place_id === input.place.kakao_place_id)) return;
      m.mutate({ ...input, id: newId(), radiusM: DEFAULT_RADIUS_M });
    },
  };
}

export function useDeleteLocation() {
  return useMutation<void, Error, DeleteVars, Ctx>({ mutationKey: mk.deleteLocation });
}
