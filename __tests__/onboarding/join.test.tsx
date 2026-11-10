import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Join from '@/app/(auth)/join';
import { GroupError, joinFamily } from '@/src/groups/group-api';
import { clearPendingInvite, getPendingInvite } from '@/src/onboarding/pending-invite';

const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/src/groups/group-api', () => ({
  ...jest.requireActual('@/src/groups/group-api'),
  joinFamily: jest.fn(),
}));
jest.mock('@/src/onboarding/pending-invite', () => ({
  getPendingInvite: jest.fn().mockResolvedValue(null),
  clearPendingInvite: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));

const join = joinFamily as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

async function submit(code = '123456') {
  await render(<Join />);
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
  await render(<Join />);
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

it('prefills the code from the deep link param', async () => {
  mockParams = { code: '654321' };
  await render(<Join />);
  expect(screen.getByDisplayValue('654321')).toBeTruthy();
});

it('prefills from the pending invite', async () => {
  (getPendingInvite as jest.Mock).mockResolvedValueOnce('111222');
  await render(<Join />);
  expect(await screen.findByDisplayValue('111222')).toBeTruthy();
});
