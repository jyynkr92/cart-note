import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  createFamily,
  fetchFamilyMembers,
  fetchMyFamilies,
  leaveFamily,
  regenerateInviteCode,
  renameFamily,
  type Family,
} from '@/src/groups/group-api';
import { toast } from '@/src/lib/toast';
import { clearPendingInvite } from '@/src/onboarding/pending-invite';
import { createQueryClient } from '@/src/lib/query-client';
import { qk } from '@/src/lib/query-keys';
import { updateDisplayName } from '@/src/onboarding/profile-api';
import { closingSheetCount, holdSheetDismissals } from '@/test-utils/bottom-sheet';
import { disposeClient } from '@/test-utils/dispose-client';

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, push: mockPush }),
}));
jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/src/lib/toast', () => ({ toast: { error: jest.fn(), info: jest.fn() } }));
jest.mock('@/src/onboarding/pending-invite', () => ({
  clearPendingInvite: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/src/items/item-api', () => ({}));
let mockAuth: { session: unknown; loading: boolean; offlineUserId: string | null } = {
  session: { user: { id: 'u1' } },
  loading: false,
  offlineUserId: null,
};
jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => mockAuth,
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

// 기기 시간대와 무관하게 "3월 5일"로 보이도록 로컬 시각으로 만든다.
const FUTURE = new Date(2099, 2, 5, 12).toISOString();
const fam = (
  id: string,
  name: string,
  created_at: string,
  invite_code = '01234567',
  invite_code_expires_at = FUTURE,
): Family => ({
  id,
  name,
  invite_code,
  invite_code_expires_at,
  created_at,
  created_by: 'u1',
});
const G1 = fam('g1', '우리집', '2026-01-01T00:00:00Z');
const G2 = fam('g2', '회사', '2026-02-01T00:00:00Z', '99988877');

const families = fetchMyFamilies as jest.Mock;
const members = fetchFamilyMembers as jest.Mock;

let client: QueryClient;
const renderSettings = () =>
  render(
    <QueryClientProvider client={client}>
      <Settings />
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
  await screen.findByText('01234567');
  await screen.findByText('은정');
}

it('shows the invite code and member names, with a fallback for no name', async () => {
  await ready();
  expect(await screen.findByText('은정')).toBeTruthy();
  expect(screen.getByText('이름 없음')).toBeTruthy();
});

it('copies the invite code and confirms it', async () => {
  await ready();
  await fireEvent.press(screen.getByText('복사'));
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('01234567');
  await waitFor(() => expect(toast.info).toHaveBeenCalledWith('복사했어요'));
});

it('reports a copy failure instead of throwing', async () => {
  (Clipboard.setStringAsync as jest.Mock).mockRejectedValueOnce(new Error('denied'));
  await ready();
  await fireEvent.press(screen.getByText('복사'));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('복사하지 못했어요'));
  expect(toast.info).not.toHaveBeenCalled();
});

it('shows a message with a close button when the group cannot be loaded', async () => {
  families.mockResolvedValue([]);
  await renderSettings();
  expect(await screen.findByText('그룹 정보를 불러올 수 없어요')).toBeTruthy();
  await fireEvent.press(screen.getByText('닫기'));
  expect(mockBack).toHaveBeenCalled();
});

it('still offers sign-out when the group cannot be loaded', async () => {
  (signOut as jest.Mock).mockResolvedValue(undefined);
  families.mockResolvedValue([]);
  await renderSettings();
  await fireEvent.press(await screen.findByText('로그아웃'));
  await waitFor(() => expect(signOut).toHaveBeenCalled());
  expect(clearPendingInvite).toHaveBeenCalled();
});

it('regenerates only once on a double tap', async () => {
  let finish!: (v: string) => void;
  (regenerateInviteCode as jest.Mock).mockReturnValue(new Promise<string>((r) => (finish = r)));
  await ready();
  await fireEvent.press(screen.getByText('코드 재발급'));
  const confirm = await screen.findByText('재발급');
  await fireEvent.press(confirm);
  await fireEvent.press(confirm);
  await act(async () => finish('55555555'));
  expect(regenerateInviteCode).toHaveBeenCalledTimes(1);
});

it('shares a message with the code and the deep link', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  await ready();
  await fireEvent.press(screen.getByText('가족 초대하기'));
  const { message } = share.mock.calls[0][0] as { message: string };
  expect(message).toContain('01234567');
  expect(message).toContain('cartnote://join?code=01234567');
  share.mockRestore();
});

it('regenerates the code only after confirming', async () => {
  (regenerateInviteCode as jest.Mock).mockResolvedValue('55555555');
  await ready();
  await fireEvent.press(screen.getByText('코드 재발급'));
  expect(regenerateInviteCode).not.toHaveBeenCalled();
  families.mockResolvedValue([{ ...G1, invite_code: '55555555' }, G2]);
  await fireEvent.press(await screen.findByText('재발급'));
  await waitFor(() => expect(regenerateInviteCode).toHaveBeenCalledWith('g1'));
  expect(await screen.findByText('55555555')).toBeTruthy();
});

it('shows until when the invite code is valid', async () => {
  await ready();
  expect(screen.getByText('3월 5일까지 유효')).toBeTruthy();
  expect(screen.queryByText(/만료/)).toBeNull();
});

describe('expired invite code', () => {
  beforeEach(() => {
    families.mockResolvedValue([{ ...G1, invite_code_expires_at: '2020-01-01T00:00:00Z' }, G2]);
  });

  it('says it expired and does not regenerate on its own', async () => {
    await ready();
    expect(screen.getByText('만료된 코드예요. 새 코드를 발급해 주세요')).toBeTruthy();
    expect(screen.queryByText(/까지 유효/)).toBeNull();
    expect(regenerateInviteCode).not.toHaveBeenCalled();
  });

  it('disables copy and share so an expired code is not sent', async () => {
    const share = jest.spyOn(Share, 'share');
    await ready();
    expect(screen.getByRole('button', { name: '복사' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '가족 초대하기' })).toBeDisabled();
    await fireEvent.press(screen.getByText('가족 초대하기'));
    expect(share).not.toHaveBeenCalled();
    share.mockRestore();
  });

  it('offers a prominent regenerate that still asks first', async () => {
    (regenerateInviteCode as jest.Mock).mockResolvedValue('55555555');
    await ready();
    await fireEvent.press(screen.getByRole('button', { name: '새 코드 발급' }));
    expect(regenerateInviteCode).not.toHaveBeenCalled();
    families.mockResolvedValue([{ ...G1, invite_code: '55555555' }, G2]);
    await fireEvent.press(await screen.findByText('재발급'));
    await waitFor(() => expect(regenerateInviteCode).toHaveBeenCalledWith('g1'));
    expect(await screen.findByText('3월 5일까지 유효')).toBeTruthy();
  });
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
    expect(screen.queryByText('01234567')).toBeNull();
    expect(screen.queryByText('999888')).toBeNull();
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(screen.queryByText('999888')).toBeNull();
  });

  it('goes home after leaving the last group, so the guard can create or join one', async () => {
    (leaveFamily as jest.Mock).mockResolvedValue(undefined);
    families.mockResolvedValue([G1]);
    await ready();
    families.mockResolvedValue([]);
    await fireEvent.press(screen.getByText('그룹 나가기'));
    await fireEvent.press(await screen.findByText('나가기'));
    await waitFor(() => expect(leaveFamily).toHaveBeenCalledWith('g1'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(screen.queryByText('01234567')).toBeNull();
    expect(screen.queryByText('그룹 정보를 불러올 수 없어요')).toBeNull();
  });
});

describe('leaving the last group when the follow-up check fails', () => {
  it('reports the failure and stays instead of going to a blank home', async () => {
    (leaveFamily as jest.Mock).mockResolvedValue(undefined);
    // 개인 그룹 생성(온보딩 재조회)이 실패하는 상황
    client.setQueryDefaults(qk.onboarding('u1'), {
      queryFn: () => Promise.reject(new Error('create failed')),
    });
    client.setQueryData(qk.onboarding('u1'), { step: 'ready', pendingInvite: null });
    families.mockResolvedValue([G1]);
    await ready();
    families.mockResolvedValue([]);
    await fireEvent.press(screen.getByText('그룹 나가기'));
    await fireEvent.press(await screen.findByText('나가기'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('새 그룹을 준비하지 못했어요'));
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('changing my name', () => {
  async function open() {
    await ready();
    await fireEvent.press(screen.getByText('내 이름 변경'));
    return screen.findByDisplayValue('은정');
  }

  it('prefills my name from the stored user id in offline-user mode (F6)', async () => {
    mockAuth = { session: null, loading: false, offlineUserId: 'u1' };
    try {
      const input = await open();
      expect(input.props.value).toBe('은정');
    } finally {
      mockAuth = { session: { user: { id: 'u1' } }, loading: false, offlineUserId: null };
    }
  });

  it('blocks a whitespace-only name', async () => {
    const input = await open();
    expect(input.props.maxLength).toBe(50);
    await fireEvent.changeText(input, '   ');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(updateDisplayName).not.toHaveBeenCalled();
  });

  it('saves the trimmed name and refreshes the member lists of my groups', async () => {
    (updateDisplayName as jest.Mock).mockResolvedValue(undefined);
    const input = await open();
    const spy = jest.spyOn(client, 'invalidateQueries');
    await fireEvent.changeText(input, '  정이  ');
    await fireEvent.press(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(updateDisplayName).toHaveBeenCalledWith('u1', '정이'));
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(keys).toEqual(expect.arrayContaining([['members', 'g1'], ['members', 'g2']]));
    });
  });
});

describe('group management', () => {
  it('renames the current group', async () => {
    (renameFamily as jest.Mock).mockResolvedValue(undefined);
    await ready();
    await fireEvent.press(screen.getByText('그룹 이름 변경'));
    const input = await screen.findByDisplayValue('우리집');
    await fireEvent.changeText(input, '  우리 집  ');
    await fireEvent.press(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(renameFamily).toHaveBeenCalledWith('g1', '우리 집'));
  });

  it('keeps the rename title while the sheet closes after saving', async () => {
    (renameFamily as jest.Mock).mockResolvedValue(undefined);
    await ready();
    await fireEvent.press(screen.getByText('그룹 이름 변경'));
    await fireEvent.changeText(await screen.findByDisplayValue('우리집'), '우리 집');
    const release = holdSheetDismissals();
    await fireEvent.press(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(closingSheetCount()).toBe(1));
    expect(screen.getByRole('header', { name: '그룹 이름 변경' })).toBeTruthy();
    expect(screen.queryByRole('header', { name: '새 그룹' })).toBeNull();
    await release();
    expect(screen.queryByRole('header', { name: '그룹 이름 변경' })).toBeNull();
  });

  it('blocks a whitespace-only group name', async () => {
    await ready();
    await fireEvent.press(screen.getByText('그룹 이름 변경'));
    await fireEvent.changeText(await screen.findByDisplayValue('우리집'), '   ');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });

  it('creates a new group and selects it', async () => {
    const G3 = fam('g3', '친구들', '2026-03-01T00:00:00Z', '333333');
    (createFamily as jest.Mock).mockImplementation(async () => {
      families.mockResolvedValue([G1, G2, G3]);
      return 'g3';
    });
    await ready();
    await fireEvent.press(screen.getByText('새 그룹 만들기'));
    await fireEvent.changeText(await screen.findByPlaceholderText('그룹 이름'), '친구들');
    await fireEvent.press(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(createFamily).toHaveBeenCalledWith('친구들'));
    expect(await screen.findByText('333333')).toBeTruthy();
    expect(await AsyncStorage.getItem(CURRENT_GROUP_KEY)).toBe('g3');
  });

  it('opens join by code, even with a single group', async () => {
    families.mockResolvedValue([G1]);
    await ready();
    await fireEvent.press(screen.getByText('코드로 참여'));
    expect(mockPush).toHaveBeenCalledWith('/join');
  });
});

describe('signing out', () => {
  it('clears the pending invite before signing out', async () => {
    const order: string[] = [];
    (clearPendingInvite as jest.Mock).mockImplementation(async () => void order.push('clear'));
    (signOut as jest.Mock).mockImplementation(async () => void order.push('signOut'));
    await ready();
    await fireEvent.press(screen.getByText('로그아웃'));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(order).toEqual(['clear', 'signOut']);
  });

  it('asks first when unsynced changes are queued', async () => {
    (signOut as jest.Mock).mockResolvedValue(undefined);
    await ready();
    jest.spyOn(client, 'isMutating').mockReturnValue(1);
    await fireEvent.press(screen.getByText('로그아웃'));
    expect(await screen.findByText('동기화되지 않은 변경이 사라져요.')).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole('button', { name: '로그아웃' });
    await fireEvent.press(buttons[buttons.length - 1]);
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it('reports a failed sign-out', async () => {
    (signOut as jest.Mock).mockRejectedValue(new Error('x'));
    await ready();
    await fireEvent.press(screen.getByText('로그아웃'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('로그아웃하지 못했어요'));
  });
});
