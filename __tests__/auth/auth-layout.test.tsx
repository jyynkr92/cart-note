import { render, screen } from '@testing-library/react-native';
import AuthLayout from '@/app/(auth)/_layout';

let mockAuth: { session: unknown; loading: boolean; offlineUserId: string | null };
let mockSegments: string[] = ['(auth)', 'login'];
jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  return {
    Redirect: ({ href }: { href: unknown }) => <Text>redirect:{JSON.stringify(href)}</Text>,
    Stack: () => <Text>STACK</Text>,
    useSegments: () => mockSegments,
  };
});
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));

beforeEach(() => {
  mockSegments = ['(auth)', 'login'];
});

it('shows login when signed out', async () => {
  mockAuth = { session: null, loading: false, offlineUserId: null };
  await render(<AuthLayout />);
  expect(screen.getByText('STACK')).toBeTruthy();
});

it('sends a stored-session (offline) user from login to home (B1)', async () => {
  mockAuth = { session: null, loading: false, offlineUserId: 'u1' };
  await render(<AuthLayout />);
  expect(screen.getByText('redirect:"/"')).toBeTruthy();
});

it('keeps a stored-session user on profile/join instead of forcing login (B1)', async () => {
  mockAuth = { session: null, loading: false, offlineUserId: 'u1' };
  mockSegments = ['(auth)', 'join'];
  await render(<AuthLayout />);
  expect(screen.getByText('STACK')).toBeTruthy();
});
