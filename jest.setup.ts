jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// expo-crypto는 네이티브 모듈이라 Jest에서는 Node의 crypto로 대체한다.
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));

// TanStack Query의 gc/재시도 타이머(최대 7일)가 Jest 프로세스 종료를 막지 않도록 unref한다.
import { timeoutManager } from '@tanstack/react-query';
const unref = <T,>(t: T): T => {
  (t as { unref?: () => void }).unref?.();
  return t;
};
timeoutManager.setTimeoutProvider({
  setTimeout: (cb, ms) => unref(setTimeout(cb, ms)) as unknown as number,
  clearTimeout: (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
  setInterval: (cb, ms) => unref(setInterval(cb, ms)) as unknown as number,
  clearInterval: (id) => clearInterval(id as unknown as ReturnType<typeof setInterval>),
});

// reanimated/worklets는 네이티브 모듈이 필요해 Jest에서는 최소한으로 대체한다.
jest.mock('react-native-reanimated', () => {
  const { View, Pressable } = require('react-native');
  const chain: any = new Proxy(() => chain, { get: () => chain });
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c: unknown) => c },
    FadeIn: chain,
    FadeOut: chain,
    ReduceMotion: { System: 'system' },
    Pressable,
  };
});
jest.mock(
  'lucide-react-native',
  () => new Proxy({ __esModule: true }, { get: (t, k) => (k in t ? (t as any)[k] : () => null) })
);
jest.mock('react-native-screens', () => ({ FullWindowOverlay: ({ children }: any) => children }));
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default
);

// 드롭다운은 트리거를 measure한 뒤에야 내용을 그린다. Jest의 View는 measure가 no-op이라 값을 채워 준다.
let originalMeasure: unknown;
beforeAll(() => {
  const { View } = require('react-native');
  originalMeasure = View.prototype.measure;
  View.prototype.measure = (cb: (...n: number[]) => void) => cb(0, 0, 100, 40, 0, 0);
});
afterAll(() => {
  const { View } = require('react-native');
  View.prototype.measure = originalMeasure;
});

// expo-clipboard는 네이티브 모듈이라 Jest에서는 대체한다.
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));

// 위치/백그라운드 작업/알림은 네이티브 모듈이라 Jest에서는 대체한다(테스트에서 반환값을 바꿔 쓴다).
jest.mock('expo-location', () => ({
  GeofencingEventType: { Enter: 1, Exit: 2 },
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
  getCurrentPositionAsync: jest.fn().mockResolvedValue(null),
  startGeofencingAsync: jest.fn().mockResolvedValue(undefined),
  stopGeofencingAsync: jest.fn().mockResolvedValue(undefined),
  hasStartedGeofencingAsync: jest.fn().mockResolvedValue(false),
}));
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskDefined: jest.fn().mockReturnValue(false),
}));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('n1'),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  clearLastNotificationResponse: jest.fn(),
}));

// 세션 게이트는 기본이 "세션 없음"(fail closed)이다. 테스트에서는 어떤 사용자와도 일치하는 세션으로 둔다
// (세션 게이트 동작은 __tests__/lib/session-gate.test.ts가 직접 설치해 검증한다).
import { ANY_USER_SESSION, installSessionCheck } from '@/src/lib/session-gate';
installSessionCheck(async () => ANY_USER_SESSION);
