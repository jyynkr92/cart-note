import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Join from '@/app/(auth)/join';
import { loadEmptySoloGroups } from '@/src/groups/empty-group-cleanup';
import { GroupError, deleteFamilyIfEmpty, joinFamily, leaveFamily } from '@/src/groups/group-api';
import { clearPendingInvite, getPendingInvite } from '@/src/onboarding/pending-invite';
import { CURRENT_GROUP_KEY, resetCurrentGroupStore } from '@/src/groups/current-group-store';
import { toast } from '@/src/lib/toast';
import { qk } from '@/src/lib/query-keys';
import { dismissSheetByUser } from '@/test-utils/bottom-sheet';
import { nodeAfterInput } from '@/test-utils/host-order';

const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/src/groups/group-api', () => ({
  ...jest.requireActual('@/src/groups/group-api'),
  joinFamily: jest.fn(),
  leaveFamily: jest.fn(),
  deleteFamilyIfEmpty: jest.fn(),
}));
jest.mock('@/src/groups/empty-group-cleanup', () => ({
  loadEmptySoloGroups: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/src/onboarding/pending-invite', () => ({
  getPendingInvite: jest.fn().mockResolvedValue(null),
  clearPendingInvite: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/src/lib/toast', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));

const join = joinFamily as jest.Mock;

let testClient: QueryClient;
const renderJoin = () =>
  render(
    <QueryClientProvider client={(testClient = new QueryClient())}>
      <Join />
    </QueryClientProvider>
  );

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetCurrentGroupStore();
  mockParams = {};
  (loadEmptySoloGroups as jest.Mock).mockResolvedValue([]);
});

async function submit(code = '12345678') {
  await renderJoin();
  await fireEvent.changeText(screen.getByPlaceholderText('00000000'), code);
  await fireEvent.press(screen.getByText('참여'));
}

it.each([
  ['invalid_code', '초대 코드를 찾을 수 없어요'],
  ['already_member', '이미 참여한 그룹이에요'],
  ['too_many_attempts', '잠시 후 다시 시도해 주세요'],
  ['network', '연결을 확인해 주세요'],
] as const)('shows the message for %s', async (code, message) => {
  join.mockRejectedValue(new GroupError(code));
  await submit();
  expect(await screen.findByText(message)).toBeTruthy();
  expect(mockReplace).not.toHaveBeenCalled();
  // 오류는 입력란 바로 아래에 alert로 읽힌다.
  expect(nodeAfterInput('00000000')).toEqual({ role: 'alert', text: message });
});

it('treats an unknown thrown error as a network error', async () => {
  join.mockRejectedValue(new Error('boom'));
  await submit();
  expect(await screen.findByText('연결을 확인해 주세요')).toBeTruthy();
});

it('disables the button below 8 digits', async () => {
  await renderJoin();
  await fireEvent.changeText(screen.getByPlaceholderText('00000000'), '1234567');
  expect(screen.getByRole('button', { name: '참여' })).toBeDisabled();
  await fireEvent.press(screen.getByText('참여'));
  expect(join).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByPlaceholderText('00000000'), '12345678');
  expect(screen.getByRole('button', { name: '참여' })).not.toBeDisabled();
});

it('joins, clears the pending invite and goes home', async () => {
  join.mockResolvedValue('f1');
  await submit('01234567');
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  expect(join).toHaveBeenCalledWith('01234567');
  expect(clearPendingInvite).toHaveBeenCalled();
});

it('selects the joined group as current', async () => {
  join.mockResolvedValue('f9');
  await submit();
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  expect(await AsyncStorage.getItem(CURRENT_GROUP_KEY)).toBe('f9');
});

it('stays on join when "나중에 할게요" cannot prepare a group', async () => {
  await renderJoin();
  testClient.setQueryDefaults(qk.onboarding('u1'), {
    queryFn: () => Promise.reject(new Error('create failed')),
    retry: false,
  });
  testClient.setQueryData(qk.onboarding('u1'), { step: 'join-pending', pendingInvite: null });
  await fireEvent.press(screen.getByText('나중에 할게요'));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('새 그룹을 준비하지 못했어요'));
  expect(mockReplace).not.toHaveBeenCalled();
});

it('prefills the code from the deep link param', async () => {
  mockParams = { code: '87654321' };
  await renderJoin();
  expect(screen.getByDisplayValue('87654321')).toBeTruthy();
});

it('prefills from the pending invite', async () => {
  (getPendingInvite as jest.Mock).mockResolvedValueOnce('11122233');
  await renderJoin();
  expect(await screen.findByDisplayValue('11122233')).toBeTruthy();
});

it('invalidates onboarding and families after joining', async () => {
  join.mockResolvedValue('f1');
  await renderJoin();
  const spy = jest.spyOn(testClient, 'invalidateQueries');
  await fireEvent.changeText(screen.getByPlaceholderText('00000000'), '12345678');
  await fireEvent.press(screen.getByText('참여'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
  expect(keys).toEqual(expect.arrayContaining([['onboarding', 'u1'], ['families']]));
});

it('clears the pending invite on invalid_code so it is not retried', async () => {
  join.mockRejectedValue(new GroupError('invalid_code'));
  await submit();
  expect(await screen.findByText('초대 코드를 찾을 수 없어요')).toBeTruthy();
  expect(clearPendingInvite).toHaveBeenCalled();
});

describe('empty solo group cleanup', () => {
  beforeEach(() => join.mockResolvedValue('j'));

  it('asks with the group name and deletes it atomically on [삭제] (B9)', async () => {
    (loadEmptySoloGroups as jest.Mock).mockResolvedValue([{ id: 'solo', name: '내 장보기' }]);
    (deleteFamilyIfEmpty as jest.Mock).mockResolvedValue(true);
    await submit();
    expect(await screen.findByText("비어 있는 '내 장보기' 그룹을 삭제할까요?")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('삭제'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(deleteFamilyIfEmpty).toHaveBeenCalledWith('solo');
    expect(leaveFamily).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(loadEmptySoloGroups).toHaveBeenCalledWith('j');
  });

  it('does not leave on [유지]', async () => {
    (loadEmptySoloGroups as jest.Mock).mockResolvedValue([{ id: 'solo', name: '내 장보기' }]);
    await submit();
    await fireEvent.press(await screen.findByText('유지'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(leaveFamily).not.toHaveBeenCalled();
  });

  it('keeps the group and says why when it is no longer empty (B9)', async () => {
    (loadEmptySoloGroups as jest.Mock).mockResolvedValue([{ id: 'solo', name: '내 장보기' }]);
    (deleteFamilyIfEmpty as jest.Mock).mockResolvedValue(false);
    await submit();
    await fireEvent.press(await screen.findByText('삭제'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(toast.error).toHaveBeenCalledWith('그룹에 새 항목이 있어 삭제하지 않았어요');
  });

  it('tells the user when removing the empty group fails, and still finishes', async () => {
    (loadEmptySoloGroups as jest.Mock).mockResolvedValue([{ id: 'solo', name: '내 장보기' }]);
    (deleteFamilyIfEmpty as jest.Mock).mockRejectedValue(new Error('offline'));
    await submit();
    await fireEvent.press(await screen.findByText('삭제'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(toast.error).toHaveBeenCalledWith('그룹을 삭제하지 못했어요');
  });

  it('skips the prompt while offline writes are still queued (R4)', async () => {
    (loadEmptySoloGroups as jest.Mock).mockResolvedValue([{ id: 'solo', name: '내 장보기' }]);
    await renderJoin();
    // 대기 중인 쓰기(예: 개인 그룹에 넣은 항목)가 있으면 서버에는 아직 비어 보일 수 있다.
    const isMutating = jest.spyOn(testClient, 'isMutating').mockReturnValue(1);
    await fireEvent.changeText(screen.getByPlaceholderText('00000000'), '12345678');
    await fireEvent.press(screen.getByText('참여'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(isMutating).toHaveBeenCalledWith({ mutationKey: ['m'] });
    expect(loadEmptySoloGroups).not.toHaveBeenCalled();
    expect(screen.queryByText("비어 있는 '내 장보기' 그룹을 삭제할까요?")).toBeNull();
  });

  it('prompts once per group, in sequence', async () => {
    (loadEmptySoloGroups as jest.Mock).mockResolvedValue([
      { id: 'a', name: '하나' },
      { id: 'b', name: '둘' },
    ]);
    (deleteFamilyIfEmpty as jest.Mock).mockResolvedValue(true);
    await submit();
    await fireEvent.press(await screen.findByText('삭제'));
    expect(await screen.findByText("비어 있는 '둘' 그룹을 삭제할까요?")).toBeTruthy();
    await fireEvent.press(screen.getByText('유지'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(deleteFamilyIfEmpty).toHaveBeenCalledTimes(1);
    expect(deleteFamilyIfEmpty).toHaveBeenCalledWith('a');
  });

  it('deleting an empty group answers true once and never false', async () => {
    (loadEmptySoloGroups as jest.Mock).mockResolvedValue([
      { id: 'a', name: '하나' },
      { id: 'b', name: '둘' },
    ]);
    (deleteFamilyIfEmpty as jest.Mock).mockResolvedValue(true);
    await submit();
    await fireEvent.press(await screen.findByText('삭제'));
    // 다음 그룹 질문이 새 시트로 뜨고, 앞 그룹은 한 번만 지운다.
    expect(await screen.findByText("비어 있는 '둘' 그룹을 삭제할까요?")).toBeTruthy();
    expect(deleteFamilyIfEmpty).toHaveBeenCalledTimes(1);
    expect(deleteFamilyIfEmpty).toHaveBeenCalledWith('a');
    // 확인한 시트가 다음 질문까지 이어져 취소가 막히지 않는다.
    await fireEvent.press(screen.getByText('유지'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(deleteFamilyIfEmpty).toHaveBeenCalledTimes(1);
  });

  it('dismissing the cleanup sheet keeps the group (answers false once)', async () => {
    (loadEmptySoloGroups as jest.Mock).mockResolvedValue([
      { id: 'a', name: '하나' },
      { id: 'b', name: '둘' },
    ]);
    await submit();
    await screen.findByText("비어 있는 '하나' 그룹을 삭제할까요?");
    await dismissSheetByUser();
    // 끌어 닫으면 유지로 답하고 다음 그룹을 한 번만 묻는다.
    expect(await screen.findByText("비어 있는 '둘' 그룹을 삭제할까요?")).toBeTruthy();
    expect(deleteFamilyIfEmpty).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    await dismissSheetByUser();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(deleteFamilyIfEmpty).not.toHaveBeenCalled();
  });
});
