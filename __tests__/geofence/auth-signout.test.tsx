import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, cleanup, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AuthProvider, useAuth } from '@/src/auth/AuthProvider';
import { resetGeofencing } from '@/src/geofence/sync-geofences';
import { clearCurrentGroup } from '@/src/groups/current-group-store';
import { clearUserCache } from '@/src/lib/query-client';
import { clearPendingInvite } from '@/src/onboarding/pending-invite';
import { clearOnboarded } from '@/src/onboarding/onboarded-flag';
import { supabase } from '@/src/lib/supabase';
import { closeSession, sessionRestored } from '@/src/lib/session-gate';

jest.mock('@/src/lib/supabase', () => ({
  AUTH_STORAGE_KEY: 'test-auth',
  supabase: {
    auth: {
      onAuthStateChange: jest.fn(),
      startAutoRefresh: jest.fn(),
      stopAutoRefresh: jest.fn(),
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
  clearPendingInvite: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/src/onboarding/onboarded-flag', () => ({
  clearOnboarded: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/src/lib/session-gate', () => ({
  closeSession: jest.fn(),
  sessionRestored: jest.fn(),
}));
jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn().mockResolvedValue(null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

afterEach(async () => {
  await cleanup();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

it('clears the cache, the current group and geofencing on sign-out, but keeps the pending invite', async () => {
  let emit!: (event: string, session: unknown) => void;
  (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation((cb) => {
    emit = cb;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
  await render(<AuthProvider>{null}</AuthProvider>);
  await act(async () => emit('SIGNED_IN', { user: { id: 'u1' } }));
  expect(resetGeofencing).not.toHaveBeenCalled();
  expect(clearUserCache).not.toHaveBeenCalled();
  expect(clearCurrentGroup).not.toHaveBeenCalled();
  expect(clearOnboarded).not.toHaveBeenCalled();
  await act(async () => emit('SIGNED_OUT', null));
  expect(clearOnboarded).toHaveBeenCalledTimes(1);
  expect(resetGeofencing).toHaveBeenCalledTimes(1);
  expect(clearUserCache).toHaveBeenCalledTimes(1);
  expect(clearCurrentGroup).toHaveBeenCalledTimes(1);
  // 콜드 스타트 토큰 갱신 실패도 SIGNED_OUT을 보내므로 초대 코드는 로그아웃 버튼에서만 지운다.
  expect(clearPendingInvite).not.toHaveBeenCalled();
});

describe('offline cold start with an expired token (B1)', () => {
  let emit!: (event: string, session: unknown) => void;
  beforeEach(() => {
    (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation((cb) => {
      emit = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });
  });
  function Probe() {
    const { session, loading, offlineUserId } = useAuth();
    return <Text>{`loading=${loading} session=${!!session} offline=${offlineUserId}`}</Text>;
  }
  const storeSession = () =>
    AsyncStorage.setItem(
      'test-auth',
      JSON.stringify({ access_token: 'expired', refresh_token: 'r1', user: { id: '6f1c2a9e-1b2c-4d3e-8f40-0a1b2c3d4e5f' } })
    );

  it('exposes the stored user id when INITIAL_SESSION is null but a refresh token is stored', async () => {
    await storeSession();
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await act(async () => emit('INITIAL_SESSION', null));
    expect(await screen.findByText('loading=false session=false offline=6f1c2a9e-1b2c-4d3e-8f40-0a1b2c3d4e5f')).toBeTruthy();
    expect(clearUserCache).not.toHaveBeenCalled();
    expect(resetGeofencing).not.toHaveBeenCalled();
  });

  it('has no offline user without a stored refresh token', async () => {
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await act(async () => emit('INITIAL_SESSION', null));
    expect(await screen.findByText('loading=false session=false offline=null')).toBeTruthy();
  });

  it('drops the offline user on a real sign-out and when the session comes back', async () => {
    await storeSession();
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await act(async () => emit('INITIAL_SESSION', null));
    await screen.findByText('loading=false session=false offline=6f1c2a9e-1b2c-4d3e-8f40-0a1b2c3d4e5f');
    await act(async () => emit('TOKEN_REFRESHED', { user: { id: 'u1' } }));
    expect(screen.getByText('loading=false session=true offline=null')).toBeTruthy();
    await act(async () => emit('SIGNED_OUT', null));
    expect(screen.getByText('loading=false session=false offline=null')).toBeTruthy();
  });
});

describe('session gate (F2)', () => {
  it('reopens for a returning session and closes on sign-out', async () => {
    let emit!: (event: string, session: unknown) => void;
    (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation((cb) => {
      emit = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });
    await render(<AuthProvider>{null}</AuthProvider>);
    await act(async () => emit('TOKEN_REFRESHED', { user: { id: 'u1' } }));
    expect(sessionRestored).toHaveBeenCalledWith('u1');
    expect(closeSession).not.toHaveBeenCalled();
    await act(async () => emit('SIGNED_OUT', null));
    expect(closeSession).toHaveBeenCalledTimes(1);
  });
});
