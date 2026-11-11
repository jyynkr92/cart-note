import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true
  );
}

/**
 * 화면 상단 여백. 오프라인 배너가 보이는 동안에는 배너가 이미 상태 표시줄 영역을 차지하므로
 * 화면이 같은 inset을 다시 더하지 않는다.
 */
export function useTopInset(extra = 16): number {
  const { top } = useSafeAreaInsets();
  const online = useIsOnline();
  return (online ? top : 0) + extra;
}
