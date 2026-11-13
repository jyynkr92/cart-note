import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Login from '@/app/(auth)/login';
import { sendOtp, verifyOtp } from '@/src/auth/auth-api';
import { nodeAfterInput } from '@/test-utils/host-order';

jest.mock('@/src/auth/auth-api', () => ({
  sendOtp: jest.fn(),
  verifyOtp: jest.fn(),
}));

jest.mock('@/src/lib/supabase', () => ({ supabase: { auth: {} } }));

const sendOtpMock = sendOtp as jest.Mock;
const verifyOtpMock = verifyOtp as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  sendOtpMock.mockResolvedValue(undefined);
  verifyOtpMock.mockResolvedValue(undefined);
});

async function goToCodeStep() {
  await render(<Login />);
  await fireEvent.changeText(screen.getByPlaceholderText('이메일'), 'a@b.com');
  await fireEvent.press(screen.getByText('코드 받기'));
  await screen.findByText('메일로 받은 6자리 코드');
}

it('sends an OTP and shows the code step', async () => {
  await goToCodeStep();
  expect(sendOtpMock).toHaveBeenCalledWith('a@b.com');
});

it('verifies a 6 digit code', async () => {
  await goToCodeStep();
  await fireEvent.changeText(screen.getByPlaceholderText('000000'), '123456');
  await fireEvent.press(screen.getByText('확인'));
  await waitFor(() => expect(verifyOtpMock).toHaveBeenCalledWith('a@b.com', '123456'));
});

it('shows an error and resend button when verify fails', async () => {
  verifyOtpMock.mockRejectedValue(new Error('bad'));
  await goToCodeStep();
  await fireEvent.changeText(screen.getByPlaceholderText('000000'), '123456');
  await fireEvent.press(screen.getByText('확인'));
  expect(await screen.findByText('코드가 올바르지 않거나 만료되었어요')).toBeTruthy();
  expect(screen.getByText('코드 다시 받기')).toBeTruthy();
  // 오류는 입력란 바로 아래에 alert로 읽힌다.
  expect(nodeAfterInput('000000')).toEqual({
    role: 'alert',
    text: '코드가 올바르지 않거나 만료되었어요',
  });
});

it('shows a send failure as an alert right under the email input', async () => {
  sendOtpMock.mockRejectedValue(new Error('down'));
  await render(<Login />);
  await fireEvent.changeText(screen.getByPlaceholderText('이메일'), 'a@b.com');
  await fireEvent.press(screen.getByText('코드 받기'));
  await screen.findByRole('alert');
  expect(nodeAfterInput('이메일')).toEqual({
    role: 'alert',
    text: '코드를 보내지 못했어요. 잠시 후 다시 시도해 주세요',
  });
});

it('disables the send button for an invalid email', async () => {
  await render(<Login />);
  await fireEvent.changeText(screen.getByPlaceholderText('이메일'), 'nope');
  await fireEvent.press(screen.getByText('코드 받기'));
  expect(sendOtpMock).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '코드 받기' })).toBeDisabled();
});

it('shows the link error from the auth provider', async () => {
  jest.spyOn(require('@/src/auth/AuthProvider'), 'useAuth').mockReturnValue({
    session: null,
    loading: false,
    linkError: '로그인 링크가 만료되었거나 올바르지 않아요. 코드로 로그인해 주세요',
    clearLinkError: jest.fn(),
  });
  await render(<Login />);
  expect(
    screen.getByText('로그인 링크가 만료되었거나 올바르지 않아요. 코드로 로그인해 주세요'),
  ).toBeTruthy();
  jest.restoreAllMocks();
});

it('goes back to the email step', async () => {
  await goToCodeStep();
  await fireEvent.press(screen.getByText('이메일 다시 입력'));
  expect(screen.getByPlaceholderText('이메일')).toBeTruthy();
});
