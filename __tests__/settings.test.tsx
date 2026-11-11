import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PortalHost } from '@rn-primitives/portal';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';
import Settings from '@/app/(app)/settings';
import { signOut } from '@/src/auth/auth-api';
import {
  CURRENT_GROUP_KEY,
  resetCurrentGroupStore,
} from '@/src/groups/current-group-store';
import {
  fetchFamilyMembers,
  fetchMyFamilies,
  leaveFamily,
  regenerateInviteCode,
  type Family,
} from '@/src/groups/group-api';
import { createQueryClient } from '@/src/lib/query-client';
import { updateDisplayName } from '@/src/onboarding/profile-api';
import { disposeClient } from '@/test-utils/dispose-client';

const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace, back: mockBack }) }));
jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/src/lib/toast', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/src/items/item-api', () => ({}));
jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));
jest.mock('@/src/auth/auth-api', () => ({ signOut: jest.fn() }));
jest.mock('@/src/onboarding/profile-api', () => ({ updateDisplayName: jest.fn() }));
jest.mock('@/src/groups/group-api', () => ({
  fetchMyFamilies: jest.fn(),
  fetchFamilyMembers: jest.fn(),
  leaveFamily: jest.fn(),
  regenerateInviteCode: jest.fn(),
  renameFamily: jest.fn(),
  createFamily: jest.fn(),
}));

const fam = (id: string, name: string, created_at: string, invite_code = '012345'): Family => ({
  id,
  name,
  invite_code,
  created_at,
  created_by: 'u1',
});
const G1 = fam('g1', '우리집', '2026-01-01T00:00:00Z');
const G2 = fam('g2', '회사', '2026-02-01T00:00:00Z', '999888');

const families = fetchMyFamilies as jest.Mock;
const members = fetchFamilyMembers as jest.Mock;

let client: QueryClient;
const renderSettings = () =>
  render(
    <QueryClientProvider client={client}>
      <Settings />
      <PortalHost />
    </QueryClientProvider>
  );

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetCurrentGroupStore();
  client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity, staleTime: 0 } });
  families.mockResolvedValue([G1, G2]);
  members.mockResolvedValue([
    { user_id: 'u1', joined_at: '2026-01-01', display_name: '은정' },
    { user_id: 'u2', joined_at: '2026-01-02', display_name: null },
  ]);
  await AsyncStorage.setItem(CURRENT_GROUP_KEY, 'g1');
});
afterEach(async () => {
  await cleanup();
  disposeClient(client);
});

async function ready() {
  await renderSettings();
  await screen.findByText('012345');
  await screen.findByText('은정');
}

it('shows the invite code and member names, with a fallback for no name', async () => {
  await ready();
  expect(await screen.findByText('은정')).toBeTruthy();
  expect(screen.getByText('이름 없음')).toBeTruthy();
});

it('copies the invite code', async () => {
  await ready();
  await fireEvent.press(screen.getByText('복사'));
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('012345');
});

it('shares a message with the code and the deep link', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  await ready();
  await fireEvent.press(screen.getByText('가족 초대하기'));
  const { message } = share.mock.calls[0][0] as { message: string };
  expect(message).toContain('012345');
  expect(message).toContain('cartnote://join?code=012345');
  share.mockRestore();
});

it('regenerates the code only after confirming', async () => {
  (regenerateInviteCode as jest.Mock).mockResolvedValue('555555');
  await ready();
  await fireEvent.press(screen.getByText('코드 재발급'));
  expect(regenerateInviteCode).not.toHaveBeenCalled();
  families.mockResolvedValue([{ ...G1, invite_code: '555555' }, G2]);
  await fireEvent.press(await screen.findByText('재발급'));
  await waitFor(() => expect(regenerateInviteCode).toHaveBeenCalledWith('g1'));
  expect(await screen.findByText('555555')).toBeTruthy();
});

it('does not regenerate when cancelled', async () => {
  await ready();
  await fireEvent.press(screen.getByText('코드 재발급'));
  await fireEvent.press(await screen.findByText('취소'));
  expect(regenerateInviteCode).not.toHaveBeenCalled();
});

describe('leaving the group', () => {
  it('confirms, leaves, then switches to the remaining group', async () => {
    (leaveFamily as jest.Mock).mockResolvedValue(undefined);
    await ready();
    await fireEvent.press(screen.getByText('그룹 나가기'));
    expect(leaveFamily).not.toHaveBeenCalled();
    families.mockResolvedValue([G2]);
    await fireEvent.press(await screen.findByText('나가기'));
    await waitFor(() => expect(leaveFamily).toHaveBeenCalledWith('g1'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(await AsyncStorage.getItem(CURRENT_GROUP_KEY)).toBe('g2');
  });

  it('invalidates families and onboarding', async () => {
    (leaveFamily as jest.Mock).mockResolvedValue(undefined);
    await ready();
    const spy = jest.spyOn(client, 'invalidateQueries');
    families.mockResolvedValue([G2]);
    await fireEvent.press(screen.getByText('그룹 나가기'));
    await fireEvent.press(await screen.findByText('나가기'));
    await waitFor(() => expect(leaveFamily).toHaveBeenCalled());
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(keys).toEqual(expect.arrayContaining([['onboarding', 'u1'], ['families']]));
    });
  });

  it('does not flash another group or an empty screen while leaving', async () => {
    let finish!: () => void;
    (leaveFamily as jest.Mock).mockReturnValue(new Promise<void>((r) => (finish = r)));
    await ready();
    await fireEvent.press(screen.getByText('그룹 나가기'));
    families.mockResolvedValue([G2]);
    await fireEvent.press(await screen.findByText('나가기'));
    await act(async () => finish());
    expect(screen.queryByText('012345')).toBeNull();
    expect(screen.queryByText('999888')).toBeNull();
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(screen.queryByText('999888')).toBeNull();
  });

  it('leaves the guard to handle the no-group case', async () => {
    (leaveFamily as jest.Mock).mockResolvedValue(undefined);
    families.mockResolvedValue([G1]);
    await ready();
    families.mockResolvedValue([]);
    await fireEvent.press(screen.getByText('그룹 나가기'));
    await fireEvent.press(await screen.findByText('나가기'));
    await waitFor(() => expect(leaveFamily).toHaveBeenCalledWith('g1'));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByText('012345')).toBeNull();
  });
});

describe('changing my name', () => {
  async function open() {
    await ready();
    await fireEvent.press(screen.getByText('내 이름 변경'));
    return screen.findByDisplayValue('은정');
  }

  it('blocks a whitespace-only name', async () => {
    const input = await open();
    await fireEvent.changeText(input, '   ');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(updateDisplayName).not.toHaveBeenCalled();
  });

  it('saves the trimmed name', async () => {
    (updateDisplayName as jest.Mock).mockResolvedValue(undefined);
    const input = await open();
    await fireEvent.changeText(input, '  정이  ');
    await fireEvent.press(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(updateDisplayName).toHaveBeenCalledWith('u1', '정이'));
  });
});

it('signs out', async () => {
  (signOut as jest.Mock).mockResolvedValue(undefined);
  await ready();
  await fireEvent.press(screen.getByText('로그아웃'));
  await waitFor(() => expect(signOut).toHaveBeenCalled());
});
