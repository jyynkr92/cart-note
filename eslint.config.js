// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Edge Function 진입점(index.ts)은 Deno 전용이라 tsconfig와 같이 뺀다. handler.ts는 린트·타입 검사·테스트 대상이다.
    ignores: [
      'dist/*',
      '.expo/*',
      'coverage/*',
      'ios/*',
      'android/*',
      '.superpowers/*',
      'supabase/functions/**/index.ts',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // tsc가 네임스페이스 멤버를 검사한다. 이 규칙은 expo-notifications의 re-export enum을 따라가지 못해 오탐을 낸다.
      'import/namespace': 'off',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['components/ui/sheet.tsx', 'test-utils/**', '__tests__/**'],
    rules: {
      // 시트 안에 라이브러리 스크롤 영역을 따로 넣으면 BottomSheetView와 contentHeight를 서로 덮어써
      // 시트 높이가 잘린다(docs/solutions 참고). 시트 내용 컨테이너는 components/ui/sheet.tsx만 고른다.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@gorhom/bottom-sheet',
              importNames: [
                'BottomSheetView',
                'BottomSheetScrollView',
                'BottomSheetFlatList',
                'BottomSheetSectionList',
                'BottomSheetVirtualizedList',
              ],
              message:
                '시트 내용 컨테이너는 components/ui/sheet.tsx가 정한다. 목록이 길면 <Sheet scrollable>을 쓴다.',
            },
            {
              // 시트 포털 안의 제어 입력 칸은 iOS 한글 조합을 깬다(docs/solutions/ui-bugs 참고).
              name: '@gorhom/bottom-sheet',
              importNames: ['BottomSheetTextInput'],
              message:
                '시트 안 입력 칸은 SheetInput(components/ui/sheet.tsx)을 쓴다. value를 그대로 넘기면 iOS 한글 조합이 풀린다.',
            },
          ],
        },
      ],
    },
  },
  {
    rules: {
      // React Compiler 전용 규칙. 이 앱은 컴파일러를 켜지 않았고, 걸리는 곳(온보딩 상태, 선택 초기화 등)은
      // 리뷰를 거친 의도된 패턴이다. 고치는 일은 후속 작업으로 두고 지금은 경고로만 보여 준다.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]);
