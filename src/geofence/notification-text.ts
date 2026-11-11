/** "[그룹명] {지점명} 근처예요 · 사야 할 것 {n}개". 그룹이 1개면 그룹명 생략, 개수를 모르면 개수 생략. */
export function notificationText(p: {
  groupName: string;
  placeName: string;
  count: number | null;
  groupCount: number;
}): string {
  const prefix = p.groupCount > 1 ? `[${p.groupName}] ` : '';
  const suffix = p.count === null ? '' : ` · 사야 할 것 ${p.count}개`;
  return `${prefix}${p.placeName} 근처예요${suffix}`;
}
