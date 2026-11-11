import { familyItemCount, fetchFamilyMembers, fetchMyFamilies } from './group-api';

export type GroupSummary = { id: string; name: string; memberCount: number; itemCount: number };

/** 방금 참여한 그룹을 뺀, 나 혼자 있고 항목이 없는 그룹. */
export function findEmptySoloGroups(
  families: GroupSummary[],
  joinedId: string
): Array<{ id: string; name: string }> {
  return families
    .filter((f) => f.id !== joinedId && f.memberCount === 1 && f.itemCount === 0)
    .map(({ id, name }) => ({ id, name }));
}

/** 정리 후보를 서버에서 조회한다. 실패하면 프롬프트를 건너뛰도록 빈 배열을 돌려준다. */
export async function loadEmptySoloGroups(
  joinedId: string
): Promise<Array<{ id: string; name: string }>> {
  try {
    const mine = (await fetchMyFamilies()).filter((f) => f.id !== joinedId);
    const summaries = await Promise.all(
      mine.map(async (f) => {
        const [members, itemCount] = await Promise.all([fetchFamilyMembers(f.id), familyItemCount(f.id)]);
        return { id: f.id, name: f.name, memberCount: members.length, itemCount };
      })
    );
    return findEmptySoloGroups(summaries, joinedId);
  } catch {
    return [];
  }
}
