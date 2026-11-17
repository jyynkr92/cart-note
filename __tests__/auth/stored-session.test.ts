import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasStoredSession, readStoredSession } from '@/src/auth/stored-session';

jest.mock('@/src/lib/supabase', () => ({ AUTH_STORAGE_KEY: 'test-auth', supabase: {} }));

const UID = '6f1c2a9e-1b2c-4d3e-8f40-0a1b2c3d4e5f';
const store = (v: unknown) => AsyncStorage.setItem('test-auth', JSON.stringify(v));

beforeEach(() => AsyncStorage.clear());

it('accepts a session with a refresh token and a uuid user id', async () => {
  await store({ refresh_token: 'r1', user: { id: UID } });
  await expect(readStoredSession()).resolves.toEqual({ userId: UID });
  await expect(hasStoredSession()).resolves.toBe(true);
});

it.each([
  ['no refresh token', { user: { id: UID } }],
  ['empty refresh token', { refresh_token: '', user: { id: UID } }],
  ['no user', { refresh_token: 'r1' }],
  ['non-uuid user id', { refresh_token: 'r1', user: { id: 'u1' } }],
  ['empty user id', { refresh_token: 'r1', user: { id: '' } }],
  ['numeric user id', { refresh_token: 'r1', user: { id: 42 } }],
])('rejects a stored session with %s (F5)', async (_n, v) => {
  await store(v);
  await expect(readStoredSession()).resolves.toBeNull();
  await expect(hasStoredSession()).resolves.toBe(false);
});

it('rejects unreadable storage', async () => {
  await AsyncStorage.setItem('test-auth', '{not json');
  await expect(readStoredSession()).resolves.toBeNull();
});
