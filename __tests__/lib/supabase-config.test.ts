// 지오펜스 백그라운드 작업은 저장된 세션을 AUTH_STORAGE_KEY로 직접 읽는다.
// 실제 클라이언트가 같은 키로 세션을 저장하는지 계약으로 고정한다.
const mockCreateClient = jest.fn((..._args: unknown[]) => ({ auth: {} }));
jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));
jest.mock('react-native-url-polyfill/auto', () => ({}));

it('creates the client with the exported auth storage key', () => {
  const { AUTH_STORAGE_KEY } = require('@/src/lib/supabase') as { AUTH_STORAGE_KEY: string };
  expect(typeof AUTH_STORAGE_KEY).toBe('string');
  expect(AUTH_STORAGE_KEY.length).toBeGreaterThan(0);
  expect(mockCreateClient).toHaveBeenCalledTimes(1);
  const options = mockCreateClient.mock.calls[0][2] as { auth: { storageKey?: string } };
  expect(options.auth.storageKey).toBe(AUTH_STORAGE_KEY);
});
