import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { StrictMode, type ReactElement } from 'react';
import AppLayout from '@/app/(app)/_layout';
import { createFamily, fetchMyFamilies } from '@/src/groups/group-api';
import { clearPendingInvite, getPendingInvite } from '@/src/onboarding/pending-invite';
import { refreshSession, signOut } from '@/src/auth/auth-api';
import { fireEvent } from '@testing-library/react-native';
import { hasProfile } from '@/src/onboarding/profile-api';
import { isOnboarded, markOnboarded } from '@/src/onboarding/onboarded-flag';
import { useFamilyRealtime } from '@/src/realtime/use-family-realtime';
import { qk } from '@/src/lib/query-keys';
import {
  closeSession,
  openSession,
  resetSessionGateForTests,
  setNetworkOnline,
} from '@/src/lib/session-gate';

let mockStackMounts = 0;
jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  const { useEffect } = require('react');
  return {
    Redirect: ({ href }: { href: unknown }) => <Text>redirect:{JSON.stringify(href)}</Text>,
    Stack: () => {
      useEffect(() => {
        mockStackMounts++;
      }, []);
      return <Text>READY</Text>;
    },
  };
});
let mockAuth: { session: unknown; loading: boolean; offlineUserId: string | null } = {
  session: { user: { id: 'u1' } },
  loading: false,
  offlineUserId: null,
};
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/src/groups/group-api', () => ({
  createFamily: jest.fn(),
  fetchMyFamilies: jest.fn(),
}));
jest.mock('@/src/realtime/use-family-realtime', () => ({ useFamilyRealtime: jest.fn() }));
jest.mock('@/src/onboarding/pending-invite', () => ({
  getPendingInvite: jest.fn(),
  clearPendingInvite: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/src/auth/auth-api', () => ({
  signOut: jest.fn().mockResolvedValue(undefined),
  refreshSession: jest.fn().mockResolvedValue(undefined),
}));
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

beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  jest.clearAllMocks();
  mockStackMounts = 0;
  mockAuth = { session: { user: { id: 'u1' } }, loading: false, offlineUserId: null };
  await AsyncStorage.clear();
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

describe('offline cold start (R1)', () => {
  const family = { id: 'f1', name: '내 장보기', created_at: '2026-01-01T00:00:00Z' };

  it('renders the app from the persisted families cache when this user finished onboarding', async () => {
    set(true, null, 1);
    client.setQueryData(qk.families(), [family]);
    await markOnboarded('u1');
    onlineManager.setOnline(false);
    await renderWithClient(<AppLayout />);
    expect(await screen.findByText('READY')).toBeTruthy();
    expect(screen.queryByText('오프라인이라 확인할 수 없어요')).toBeNull();
  });

  it('keeps the same screen (no remount) when the connection returns', async () => {
    set(true, null, 1);
    client.setQueryData(qk.families(), [family]);
    await markOnboarded('u1');
    onlineManager.setOnline(false);
    await renderWithClient(<AppLayout />);
    expect(await screen.findByText('READY')).toBeTruthy();
    await act(async () => onlineManager.setOnline(true));
    await waitFor(() => expect(client.getQueryData(qk.onboarding('u1'))).toBeDefined());
    expect(screen.getByText('READY')).toBeTruthy();
    expect(mockStackMounts).toBe(1);
  });

  it('renders the app when the first check fails with a network error', async () => {
    set(true, null, 1);
    (hasProfile as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));
    client.setQueryData(qk.families(), [family]);
    await markOnboarded('u1');
    await renderWithClient(<AppLayout />);
    expect(await screen.findByText('READY')).toBeTruthy();
  });

  it('still shows the error screen for a non-network failure', async () => {
    set(true, null, 1);
    (hasProfile as jest.Mock).mockRejectedValue({ code: '42501', message: 'permission denied' });
    client.setQueryData(qk.families(), [family]);
    await markOnboarded('u1');
    await renderWithClient(<AppLayout />);
    expect(await screen.findByText('연결을 확인해 주세요')).toBeTruthy();
  });

  it('shows the offline screen without the onboarded flag', async () => {
    set(true, null, 1);
    client.setQueryData(qk.families(), [family]);
    onlineManager.setOnline(false);
    await renderWithClient(<AppLayout />);
    expect(await screen.findByText('오프라인이라 확인할 수 없어요')).toBeTruthy();
  });

  it("ignores another user's onboarded flag", async () => {
    set(true, null, 1);
    client.setQueryData(qk.families(), [family]);
    await markOnboarded('someone-else');
    onlineManager.setOnline(false);
    await renderWithClient(<AppLayout />);
    expect(await screen.findByText('오프라인이라 확인할 수 없어요')).toBeTruthy();
  });

  it('shows the offline screen when the families cache is empty', async () => {
    set(true, null, 1);
    await markOnboarded('u1');
    onlineManager.setOnline(false);
    await renderWithClient(<AppLayout />);
    expect(await screen.findByText('오프라인이라 확인할 수 없어요')).toBeTruthy();
  });

  it('records the onboarded flag once the user is ready', async () => {
    set(true, null, 1);
    await renderWithClient(<AppLayout />);
    expect(await screen.findByText('READY')).toBeTruthy();
    await waitFor(async () => expect(await isOnboarded('u1')).toBe(true));
  });
});

// B1: 저장된 세션은 있는데 갱신 실패로 session이 null인 경우(오프라인). 로그인 화면으로 보내거나 서버에 묻지 않는다.
describe('stored session while the live session is null (B1)', () => {
  const family = { id: 'f1', name: '내 장보기', created_at: '2026-01-01T00:00:00Z' };
  beforeEach(() => {
    mockAuth = { session: null, loading: false, offlineUserId: 'u1' };
  });

  it('shows the cached home for the stored user without asking the server', async () => {
    set(true, null, 1);
    client.setQueryData(qk.families(), [family]);
    await markOnboarded('u1');
    await renderWithClient(<AppLayout />);
    expect(await screen.findByText('READY')).toBeTruthy();
    expect(hasProfile).not.toHaveBeenCalled();
    expect(screen.queryByText('redirect:"/login"')).toBeNull();
  });

  it('shows the offline screen instead of the login redirect without cached state', async () => {
    set(true, null, 1);
    await renderWithClient(<AppLayout />);
    expect(await screen.findByText('오프라인이라 확인할 수 없어요')).toBeTruthy();
    expect(screen.queryByText('redirect:"/login"')).toBeNull();
    expect(hasProfile).not.toHaveBeenCalled();
  });
});

describe('session gate (F2)', () => {
  afterEach(() => resetSessionGateForTests());

  it('shows a spinner, not the offline wall, while the network is up but the session gate is still closed', async () => {
    set(true, null, 1);
    setNetworkOnline(true);
    closeSession();
    await renderWithClient(<AppLayout />);
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(screen.queryByText('오프라인이라 확인할 수 없어요')).toBeNull();
    expect(hasProfile).not.toHaveBeenCalled();
    await act(async () => openSession('u1'));
    expect(await screen.findByText('READY')).toBeTruthy();
  });
});

describe('offline wall actions (F6)', () => {
  it('offers retry and sign-out on the offline wall', async () => {
    set(true, null, 1);
    onlineManager.setOnline(false);
    await renderWithClient(<AppLayout />);
    expect(await screen.findByText('오프라인이라 확인할 수 없어요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeTruthy();
  });

  it('retry refetches onboarding', async () => {
    set(true, null, 1);
    onlineManager.setOnline(false);
    await renderWithClient(<AppLayout />);
    await screen.findByText('오프라인이라 확인할 수 없어요');
    const query = client.getQueryCache().find({ queryKey: qk.onboarding('u1') })!;
    const fetch = jest.spyOn(query, 'fetch');
    await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
    expect(fetch).toHaveBeenCalled();
  });

  it('sign-out clears the pending invite first, then signs out locally', async () => {
    const order: string[] = [];
    (clearPendingInvite as jest.Mock).mockImplementationOnce(async () => void order.push('clear'));
    (signOut as jest.Mock).mockImplementationOnce(async () => void order.push('signOut'));
    set(true, null, 1);
    onlineManager.setOnline(false);
    await renderWithClient(<AppLayout />);
    await screen.findByText('오프라인이라 확인할 수 없어요');
    await fireEvent.press(screen.getByRole('button', { name: '로그아웃' }));
    await waitFor(() => expect(order).toEqual(['clear', 'signOut']));
  });

  it('in offline-user mode, retry tries to restore the session instead of asking the server anonymously', async () => {
    mockAuth = { session: null, loading: false, offlineUserId: 'u1' };
    set(true, null, 1);
    await renderWithClient(<AppLayout />);
    await screen.findByText('오프라인이라 확인할 수 없어요');
    await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(refreshSession).toHaveBeenCalled());
    expect(hasProfile).not.toHaveBeenCalled();
  });
});
