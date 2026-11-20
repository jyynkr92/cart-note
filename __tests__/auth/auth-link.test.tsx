// 매직링크 딥링크 처리: PKCE 코드만 받고, 로그인 중이면 무시하며, 토큰 프래그먼트는 거부한다.
import { act, cleanup, render, screen } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { Text } from 'react-native';
import { AuthProvider, LINK_ERROR_MESSAGE, useAuth } from '@/src/auth/AuthProvider';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      startAutoRefresh: jest.fn(),
      stopAutoRefresh: jest.fn(),
      getSession: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      setSession: jest.fn(),
    },
  },
}));
jest.mock('@/src/lib/query-client', () => ({ clearUserCache: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/src/geofence/sync-geofences', () => ({
  resetGeofencing: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/src/groups/current-group-store', () => ({
  clearCurrentGroup: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/src/onboarding/pending-invite', () => ({
  capturePendingInvite: jest.fn().mockResolvedValue(false),
}));
jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;

function LinkError() {
  const { linkError } = useAuth();
  return <Text testID="link-error">{linkError ?? ''}</Text>;
}

async function openWith(url: string) {
  (Linking.getInitialURL as jest.Mock).mockResolvedValue(url);
  await render(
    <AuthProvider>
      <LinkError />
    </AuthProvider>,
  );
  // getInitialURL → getSession → exchange 체인이 끝날 때까지 비운다.
  await act(async () => {
    await new Promise<void>((r) => setImmediate(() => r()));
  });
}

afterEach(async () => {
  await cleanup();
});

beforeEach(() => {
  jest.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
});

it('exchanges a PKCE code from the magic link when signed out', async () => {
  await openWith('cartnote://auth?code=good');
  expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('good', undefined);
  expect(screen.getByTestId('link-error').props.children).toBe('');
});

it('shows the link error when the code is foreign or invalid', async () => {
  auth.exchangeCodeForSession.mockResolvedValue({
    data: {},
    error: new Error('PKCE code verifier not found in storage'),
  });
  await openWith('cartnote://auth?code=from-attacker');
  expect(screen.getByTestId('link-error').props.children).toBe(LINK_ERROR_MESSAGE);
});

it('ignores auth links while a session already exists', async () => {
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
  await openWith('cartnote://auth?code=from-attacker');
  expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  expect(auth.setSession).not.toHaveBeenCalled();
  expect(screen.getByTestId('link-error').props.children).toBe('');
});

it('rejects token fragment links without setting a session', async () => {
  await openWith('cartnote://auth#access_token=attacker&refresh_token=attacker');
  expect(auth.setSession).not.toHaveBeenCalled();
  expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  expect(screen.getByTestId('link-error').props.children).toBe(LINK_ERROR_MESSAGE);
});
