import { useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/src/lib/query-keys';
import { useCurrentGroupStore, resolveCurrentFamily } from './current-group-store';
import { fetchFamilyMembers, fetchMyFamilies, renameFamily, type Family } from './group-api';

export function useFamilies() {
  return useQuery({ queryKey: qk.families(), queryFn: fetchMyFamilies });
}

export function useFamilyMembers(familyId: string | null) {
  return useQuery({
    queryKey: qk.members(familyId ?? ''),
    queryFn: () => fetchFamilyMembers(familyId!),
    enabled: !!familyId,
  });
}

/** 현재 그룹. 그룹이 없거나 아직 불러오는 중이면 family는 null(온보딩 가드가 생성/참여로 보낸다). */
export function useCurrentGroup(): { family: Family | null; families: Family[]; loading: boolean } {
  const { familyId, ready } = useCurrentGroupStore();
  const q = useFamilies();
  const families = q.data ?? [];
  const id = ready && q.data ? resolveCurrentFamily(familyId, families) : null;
  return {
    family: families.find((f) => f.id === id) ?? null,
    families,
    loading: !ready || q.isPending,
  };
}

export function useCurrentFamily(): Family | null {
  return useCurrentGroup().family;
}

export function useRenameFamily() {
  const qc = useQueryClient();
  return async (id: string, name: string) => {
    await renameFamily(id, name);
    await qc.invalidateQueries({ queryKey: qk.families() });
  };
}
