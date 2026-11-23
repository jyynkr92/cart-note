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
    rules: {
      // React Compiler 전용 규칙. 이 앱은 컴파일러를 켜지 않았고, 걸리는 곳(온보딩 상태, 선택 초기화 등)은
      // 리뷰를 거친 의도된 패턴이다. 고치는 일은 후속 작업으로 두고 지금은 경고로만 보여 준다.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]);
