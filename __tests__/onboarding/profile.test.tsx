import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import Profile from '@/app/(auth)/profile';
import { createProfile } from '@/src/onboarding/profile-api';
import { MAX_LENGTH } from '@/src/lib/text';
import { nodeAfterInput } from '@/test-utils/host-order';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('@/src/onboarding/profile-api', () => ({ createProfile: jest.fn() }));
jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));

let client: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient();
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

const renderProfile = () =>
  render(
    <QueryClientProvider client={client}>
      <Profile />
    </QueryClientProvider>
  );

it('limits the name to the DB length (A13)', async () => {
  await renderProfile();
  expect(screen.getByPlaceholderText('이름').props.maxLength).toBe(MAX_LENGTH.displayName);
});

it('shows a save failure as an alert right under the input', async () => {
  (createProfile as jest.Mock).mockRejectedValue(new Error('offline'));
  await renderProfile();
  await fireEvent.changeText(screen.getByPlaceholderText('이름'), '은정');
  await fireEvent.press(screen.getByText('시작하기'));
  await screen.findByRole('alert');
  expect(nodeAfterInput('이름')).toEqual({
    role: 'alert',
    text: '저장하지 못했어요. 연결을 확인해 주세요',
  });
  expect(mockReplace).not.toHaveBeenCalled();
});
