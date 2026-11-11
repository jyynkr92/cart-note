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
