import { onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { useTopInset } from '@/src/lib/use-top-inset';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));

afterEach(() => onlineManager.setOnline(true));

it('adds the safe-area top inset while online', async () => {
  onlineManager.setOnline(true);
  const { result } = await renderHook(() => useTopInset());
  expect(result.current).toBe(56);
});

it('drops the inset while offline because the banner already covers it', async () => {
  onlineManager.setOnline(false);
  const { result } = await renderHook(() => useTopInset());
  expect(result.current).toBe(16);
  await act(async () => onlineManager.setOnline(true));
  expect(result.current).toBe(56);
});
