import { onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { useTopInset } from '@/src/lib/use-top-inset';
import * as gate from '@/src/lib/session-gate';

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

describe('session gate (F2)', () => {
  afterEach(() => gate.resetSessionGateForTests());

  it('follows the network, not the session gate (no offline banner while waiting for a session)', async () => {
    gate.setNetworkOnline(true);
    gate.closeSession(); // onlineManager는 꺼진다(큐 보류)
    expect(onlineManager.isOnline()).toBe(false);
    const { result } = await renderHook(() => useTopInset());
    expect(result.current).toBe(56);
    await act(async () => gate.setNetworkOnline(false));
    expect(result.current).toBe(16);
  });
});
