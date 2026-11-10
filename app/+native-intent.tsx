// 매직링크(cartnote://auth#…)는 AuthProvider가 처리하므로 라우팅은 홈으로 돌린다.
// Task 6에서 join 등 다른 경로를 여기에 추가한다.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (/^(?:cartnote:\/\/)?\/?auth(?:[/?#]|$)/.test(path)) return '/';
  return path;
}
