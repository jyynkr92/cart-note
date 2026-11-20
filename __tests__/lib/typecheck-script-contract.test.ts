/**
 * `npm run typecheck`가 typed routes를 실제로 검사하는지에 대한 계약.
 *
 * expo-router의 Href는 생성된 라우트 타입(.expo/types/router.d.ts)이 ExpoRouter.__routes를 채워야 좁혀진다.
 * 그 파일이 없으면 Href는 조용히 `string | HrefObject`로 풀린다
 * (node_modules/expo-router/build/typed-routes/types.d.ts의 Href 정의). 그러면 없는 경로로 router.push해도
 * tsc가 통과한다. .expo/는 gitignore라서 새로 받은 체크아웃과 CI에는 이 파일이 없다.
 *
 * 그래서 typecheck 스크립트는 tsc 전에 `expo customize tsconfig.json`으로 라우트 타입을 만든다. 이 명령은
 * tsconfig.json을 바꾸지 않고 .expo/types만 생성한다(Task 9에서 확인). 스크립트를 `tsc --noEmit`만으로
 * 줄이거나, 로컬에 남은 .expo/types나 `expo start`를 잠깐 띄워 만든 타입에 기대면 로컬에서는 통과하고
 * 새 체크아웃에서는 경로 검사가 꺼진다. .expo/types를 커밋하는 것도 답이 아니다(라우트가 바뀌면 낡는다).
 */
import { fs, path } from '@/test-utils/node-fs';

const ROOT = process.cwd();

it('typecheck script generates expo-router route types before tsc (else Href falls back to string and wrong routes pass)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const script: string = pkg.scripts?.typecheck ?? '';
  const generate = script.indexOf('expo customize tsconfig.json');
  const tsc = script.search(/\btsc\b/);
  expect({ script, generatesBeforeTsc: generate !== -1 && tsc !== -1 && generate < tsc }).toEqual({
    script,
    generatesBeforeTsc: true,
  });
});

it('tsconfig includes the generated route types', () => {
  const tsconfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8'));
  expect(tsconfig.include).toContain('.expo/types/**/*.ts');
});
