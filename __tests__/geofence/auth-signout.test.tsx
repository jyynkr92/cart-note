import { act, cleanup, render } from '@testing-library/react-native';
import { AuthProvider } from '@/src/auth/AuthProvider';
import { resetGeofencing } from '@/src/geofence/sync-geofences';
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
jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn().mockResolvedValue(null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

afterEach(async () => {
  await cleanup();
});

it('stops geofencing and clears its data on sign-out', async () => {
  let emit!: (event: string, session: unknown) => void;
  (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation((cb) => {
    emit = cb;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
  await render(<AuthProvider>{null}</AuthProvider>);
  await act(async () => emit('SIGNED_IN', { user: { id: 'u1' } }));
  expect(resetGeofencing).not.toHaveBeenCalled();
  await act(async () => emit('SIGNED_OUT', null));
  expect(resetGeofencing).toHaveBeenCalledTimes(1);
});
