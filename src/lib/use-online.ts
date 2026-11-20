import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { getNetworkOnline, subscribeNetwork } from './session-gate';

/**
 * 네트워크 연결 여부(오프라인 배너용). onlineManager는 세션 게이트(network && session)라서 세션을 기다리는 동안
 * 오프라인으로 보이므로, 게이트가 아는 네트워크 상태를 우선 쓰고 모를 때만 onlineManager를 쓴다.
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const a = onlineManager.subscribe(cb);
      const b = subscribeNetwork(cb);
      return () => {
        a();
        b();
      };
    },
    () => getNetworkOnline() ?? onlineManager.isOnline(),
    () => true
  );
}
