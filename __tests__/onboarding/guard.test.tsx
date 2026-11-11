import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { StrictMode, type ReactElement } from 'react';
import AppLayout from '@/app/(app)/_layout';
import { createFamily, fetchMyFamilies } from '@/src/groups/group-api';
import { getPendingInvite } from '@/src/onboarding/pending-invite';
import { hasProfile } from '@/src/onboarding/profile-api';
import { useFamilyRealtime } from '@/src/realtime/use-family-realtime';
import { qk } from '@/src/lib/query-keys';

jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  return {
    Redirect: ({ href }: { href: unknown }) => <Text>redirect:{JSON.stringify(href)}</Text>,
    Stack: () => <Text>READY</Text>,
  };
});
jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));
jest.mock('@/src/groups/group-api', () => ({
  createFamily: jest.fn(),
  fetchMyFamilies: jest.fn(),
}));
jest.mock('@/src/realtime/use-family-realtime', () => ({ useFamilyRealtime: jest.fn() }));
jest.mock('@/src/onboarding/pending-invite', () => ({ getPendingInvite: jest.fn() }));
jest.mock('@/src/onboarding/profile-api', () => ({ hasProfile: jest.fn() }));
jest.mock('@/src/geofence/use-geofence-sync', () => ({ useGeofenceSync: jest.fn() }));
jest.mock('@/src/geofence/notification-route', () => ({ useOpenPendingNotification: jest.fn() }));

const set = (profile: boolean, pending: string | null, groups: number) => {
  (hasProfile as jest.Mock).mockResolvedValue(profile);
  (getPendingInvite as jest.Mock).mockResolvedValue(pending);
  (fetchMyFamilies as jest.Mock).mockResolvedValue(Array(groups).fill({}));
};

let client: QueryClient;
const renderWithClient = (ui: ReactElement) =>
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  jest.clearAllMocks();
  (createFamily as jest.Mock).mockResolvedValue('f1');
});
afterEach(() => {
  onlineManager.setOnline(true);
  client.clear();
});

it('redirects to /profile without a profile', async () => {
  set(false, null, 0);
  await renderWithClient(<AppLayout />);
  expect(await screen.findByText('redirect:"/profile"')).toBeTruthy();
  expect(createFamily).not.toHaveBeenCalled();
});

it('redirects to /join with the pending code', async () => {
  set(true, '123456', 0);
  await renderWithClient(<AppLayout />);
  expect(
    await screen.findByText('redirect:{"pathname":"/join","params":{"code":"123456"}}')
  ).toBeTruthy();
  expect(createFamily).not.toHaveBeenCalled();
});

it('renders the app when the user has a group', async () => {
  set(true, null, 1);
  await renderWithClient(<AppLayout />);
  expect(await screen.findByText('READY')).toBeTruthy();
});

it('mounts realtime only for the ready group', async () => {
  set(true, null, 0);
  (fetchMyFamilies as jest.Mock).mockResolvedValue([{ id: 'f1' }]);
  await renderWithClient(<AppLayout />);
  expect(await screen.findByText('READY')).toBeTruthy();
  expect(useFamilyRealtime).toHaveBeenLastCalledWith('f1');
  expect((useFamilyRealtime as jest.Mock).mock.calls[0][0]).toBeNull();
});

it('creates the personal group exactly once under StrictMode, showing loading meanwhile', async () => {
  set(true, null, 0);
  let resolve!: (v: string) => void;
  (createFamily as jest.Mock).mockReturnValue(new Promise((r) => (resolve = r)));
  await renderWithClient(
    <StrictMode>
      <AppLayout />
    </StrictMode>
  );
  await waitFor(() => expect(createFamily).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('READY')).toBeNull();
  resolve('f1');
  expect(await screen.findByText('READY')).toBeTruthy();
  expect(createFamily).toHaveBeenCalledTimes(1);
  expect(createFamily).toHaveBeenCalledWith('내 장보기');
});

it('shows a retry on failure', async () => {
  set(true, null, 0);
  (createFamily as jest.Mock).mockRejectedValueOnce(new Error('x'));
  await renderWithClient(<AppLayout />);
  expect(await screen.findByText('연결을 확인해 주세요')).toBeTruthy();
});

it('moves from /profile to the next step after invalidation, without remounting', async () => {
  set(false, null, 0);
  await renderWithClient(<AppLayout />);
  expect(await screen.findByText('redirect:"/profile"')).toBeTruthy();

  // 프로필 저장 성공 → profile.tsx가 하는 일과 동일
  set(true, null, 1);
  await client.invalidateQueries({ queryKey: qk.onboarding('u1') });

  expect(await screen.findByText('READY')).toBeTruthy();
});

it('resolves the new personal group as current after creating it', async () => {
  set(true, null, 0);
  const created = { id: 'f1', name: '내 장보기', created_at: '2026-01-01T00:00:00Z' };
  (createFamily as jest.Mock).mockImplementation(async () => {
    (fetchMyFamilies as jest.Mock).mockResolvedValue([created]);
    return 'f1';
  });
  await renderWithClient(<AppLayout />);
  expect(await screen.findByText('READY')).toBeTruthy();
  await waitFor(() => expect(useFamilyRealtime).toHaveBeenLastCalledWith('f1'));
});

it('keeps the app when a background onboarding refetch fails', async () => {
  set(true, null, 1);
  await renderWithClient(<AppLayout />);
  expect(await screen.findByText('READY')).toBeTruthy();
  (hasProfile as jest.Mock).mockRejectedValue(new Error('offline'));
  await act(() => client.refetchQueries({ queryKey: qk.onboarding('u1') }));
  expect(client.getQueryState(qk.onboarding('u1'))?.status).toBe('error');
  // 쿼리 알림은 다음 틱에 배치로 전달된다.
  await act(() => new Promise((r) => setTimeout(r, 10)));
  expect(screen.queryByText('연결을 확인해 주세요')).toBeNull();
  expect(screen.getByText('READY')).toBeTruthy();
});

it('shows an offline message instead of a spinner when the first check is paused', async () => {
  set(true, null, 1);
  onlineManager.setOnline(false);
  await renderWithClient(<AppLayout />);
  expect(await screen.findByText('오프라인이라 확인할 수 없어요')).toBeTruthy();
});
