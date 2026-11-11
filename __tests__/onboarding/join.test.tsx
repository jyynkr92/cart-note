import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PortalHost } from '@rn-primitives/portal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Join from '@/app/(auth)/join';
import { loadEmptySoloGroups } from '@/src/groups/empty-group-cleanup';
import { GroupError, joinFamily, leaveFamily } from '@/src/groups/group-api';
import { clearPendingInvite, getPendingInvite } from '@/src/onboarding/pending-invite';
import { CURRENT_GROUP_KEY, resetCurrentGroupStore } from '@/src/groups/current-group-store';
import { toast } from '@/src/lib/toast';
import { qk } from '@/src/lib/query-keys';

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
      <PortalHost />
    </QueryClientProvider>
  );

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetCurrentGroupStore();
  mockParams = {};
  (loadEmptySoloGroups as jest.Mock).mockResolvedValue([]);
});

async function submit(code = '123456') {
  await renderJoin();
  await fireEvent.changeText(screen.getByPlaceholderText('000000'), code);
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
});

it('treats an unknown thrown error as a network error', async () => {
  join.mockRejectedValue(new Error('boom'));
  await submit();
  expect(await screen.findByText('연결을 확인해 주세요')).toBeTruthy();
});

it('disables the button below 6 digits', async () => {
  await renderJoin();
  await fireEvent.changeText(screen.getByPlaceholderText('000000'), '12345');
  expect(screen.getByRole('button', { name: '참여' })).toBeDisabled();
  await fireEvent.press(screen.getByText('참여'));
  expect(join).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByPlaceholderText('000000'), '123456');
  expect(screen.getByRole('button', { name: '참여' })).not.toBeDisabled();
});

it('joins, clears the pending invite and goes home', async () => {
  join.mockResolvedValue('f1');
  await submit('012345');
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  expect(join).toHaveBeenCalledWith('012345');
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
  mockParams = { code: '654321' };
  await renderJoin();
  expect(screen.getByDisplayValue('654321')).toBeTruthy();
});

it('prefills from the pending invite', async () => {
  (getPendingInvite as jest.Mock).mockResolvedValueOnce('111222');
  await renderJoin();
  expect(await screen.findByDisplayValue('111222')).toBeTruthy();
});

it('invalidates onboarding and families after joining', async () => {
  join.mockResolvedValue('f1');
  await renderJoin();
  const spy = jest.spyOn(testClient, 'invalidateQueries');
  await fireEvent.changeText(screen.getByPlaceholderText('000000'), '123456');
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

  it('asks with the group name and leaves it on [삭제]', async () => {
    (loadEmptySoloGroups as jest.Mock).mockResolvedValue([{ id: 'solo', name: '내 장보기' }]);
    (leaveFamily as jest.Mock).mockResolvedValue(undefined);
    await submit();
    expect(await screen.findByText("비어 있는 '내 장보기' 그룹을 삭제할까요?")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('삭제'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(leaveFamily).toHaveBeenCalledWith('solo');
    expect(loadEmptySoloGroups).toHaveBeenCalledWith('j');
  });

  it('does not leave on [유지]', async () => {
    (loadEmptySoloGroups as jest.Mock).mockResolvedValue([{ id: 'solo', name: '내 장보기' }]);
    await submit();
    await fireEvent.press(await screen.findByText('유지'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(leaveFamily).not.toHaveBeenCalled();
  });

  it('tells the user when removing the empty group fails, and still finishes', async () => {
    (loadEmptySoloGroups as jest.Mock).mockResolvedValue([{ id: 'solo', name: '내 장보기' }]);
    (leaveFamily as jest.Mock).mockRejectedValue(new Error('offline'));
    await submit();
    await fireEvent.press(await screen.findByText('삭제'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(toast.error).toHaveBeenCalledWith('그룹을 삭제하지 못했어요');
  });

  it('prompts once per group, in sequence', async () => {
    (loadEmptySoloGroups as jest.Mock).mockResolvedValue([
      { id: 'a', name: '하나' },
      { id: 'b', name: '둘' },
    ]);
    (leaveFamily as jest.Mock).mockResolvedValue(undefined);
    await submit();
    await fireEvent.press(await screen.findByText('삭제'));
    expect(await screen.findByText("비어 있는 '둘' 그룹을 삭제할까요?")).toBeTruthy();
    await fireEvent.press(screen.getByText('유지'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(leaveFamily).toHaveBeenCalledTimes(1);
    expect(leaveFamily).toHaveBeenCalledWith('a');
  });
});
