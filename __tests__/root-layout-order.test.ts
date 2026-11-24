// 루트 레이아웃은 네이티브 Provider가 많아 렌더하지 않고 JSX 순서를 본다.
// (앱 tsconfig에 node 타입이 없어 session-gate.test.ts처럼 require로 읽는다.)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const src: string = require('fs').readFileSync(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('path').join(process.cwd(), 'app/_layout.tsx'),
  'utf8'
);
const at = (needle: string) => {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error(`app/_layout.tsx에 ${needle}가 없다`);
  return i;
};

describe('root layout provider order', () => {
  it('draws toasts above bottom sheets', () => {
    // @gorhom/portal은 children 뒤에 시트 host를 그린다. ToastHost가 그 children 안에 있으면 시트에 가린다.
    expect(at('<ToastHost')).toBeGreaterThan(at('</BottomSheetModalProvider>'));
  });

  it('keeps the app contexts available inside sheets', () => {
    // 시트 내용은 Portal로 Provider 자리에서 그려지므로 Provider가 앱의 다른 Provider 안쪽에 있어야 한다.
    const open = at('<BottomSheetModalProvider>');
    const close = at('</BottomSheetModalProvider>');
    for (const provider of ['ThemeProvider', 'PersistQueryClientProvider', 'AuthProvider']) {
      expect(open).toBeGreaterThan(at(`<${provider}`));
      expect(close).toBeLessThan(at(`</${provider}>`));
    }
    expect(open).toBeGreaterThan(at('<GestureHandlerRootView'));
    expect(open).toBeLessThan(at('<RootNavigator'));
    expect(close).toBeGreaterThan(at('<RootNavigator'));
  });
});
