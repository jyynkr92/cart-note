// 매직링크(cartnote://auth#…)는 AuthProvider가 처리하므로 라우팅은 홈으로 돌린다.
// 초대 링크(cartnote://join?code=…)는 (auth)/join 화면(/join)으로 보내며 code를 보존한다.
// 대기 코드 저장은 AuthProvider의 Linking 리스너가 한다.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (/^(?:cartnote:\/\/)?\/?auth(?:[/?#]|$)/.test(path)) return '/';
  const join = /^(?:cartnote:\/\/)?\/?join\/?(\?[^#]*)?(?:#.*)?$/.exec(path);
  if (join) return `/join${join[1] ?? ''}`;
  return path;
}
