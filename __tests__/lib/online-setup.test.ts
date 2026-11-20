import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { setupOnlineManager } from '@/src/lib/query-client';
import {
  installReachabilityProbe,
  markBackendUnreachable,
  openSession,
  resetSessionGateForTests,
} from '@/src/lib/session-gate';

jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));

afterEach(() => {
  resetSessionGateForTests();
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});

it('re-probes when the app becomes active (I-2, M-3)', async () => {
  let onAppState!: (s: string) => void;
  jest.spyOn(NetInfo, 'addEventListener').mockReturnValue(() => {});
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_e, cb) => ((onAppState = cb as never), { remove: jest.fn() }) as never);
  setupOnlineManager();
  const probe = jest.fn(async () => true);
  installReachabilityProbe(probe);
  openSession('u1');
  markBackendUnreachable();
  expect(onlineManager.isOnline()).toBe(false);
  onAppState('background');
  expect(probe).not.toHaveBeenCalled();
  onAppState('active');
  await new Promise((r) => setTimeout(r, 0));
  expect(probe).toHaveBeenCalledTimes(1);
  expect(onlineManager.isOnline()).toBe(true);
});
