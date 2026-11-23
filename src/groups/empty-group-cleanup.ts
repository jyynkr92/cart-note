import { familyIsEmpty, fetchMyFamilies } from './group-api';

export type GroupSummary = { id: string; name: string; isEmpty: boolean };

/** 방금 참여한 그룹을 뺀 빈 그룹(나 혼자, 항목·추가 목록·지점 없음 — 서버 family_is_empty 판정). */
export function findEmptySoloGroups(
  families: GroupSummary[],
  joinedId: string
): { id: string; name: string }[] {
  return families
    .filter((f) => f.id !== joinedId && f.isEmpty)
    .map(({ id, name }) => ({ id, name }));
}

/** 정리 후보를 서버에서 조회한다. 실패하면 프롬프트를 건너뛰도록 빈 배열을 돌려준다. */
export async function loadEmptySoloGroups(
  joinedId: string
): Promise<{ id: string; name: string }[]> {
  try {
    const mine = (await fetchMyFamilies()).filter((f) => f.id !== joinedId);
    const summaries = await Promise.all(
      mine.map(async (f) => ({ id: f.id, name: f.name, isEmpty: await familyIsEmpty(f.id) }))
    );
    return findEmptySoloGroups(summaries, joinedId);
  } catch {
    return [];
  }
}
