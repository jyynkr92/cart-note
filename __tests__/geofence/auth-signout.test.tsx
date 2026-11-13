import { act, cleanup, render } from '@testing-library/react-native';
import { AuthProvider } from '@/src/auth/AuthProvider';
import { resetGeofencing } from '@/src/geofence/sync-geofences';
import { clearCurrentGroup } from '@/src/groups/current-group-store';
import { clearUserCache } from '@/src/lib/query-client';
import { clearPendingInvite } from '@/src/onboarding/pending-invite';
import { clearOnboarded } from '@/src/onboarding/onboarded-flag';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({
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
jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn().mockResolvedValue(null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

afterEach(async () => {
  await cleanup();
});

beforeEach(() => jest.clearAllMocks());

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
