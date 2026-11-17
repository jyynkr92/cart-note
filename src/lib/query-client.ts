import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import {
  defaultShouldDehydrateMutation,
  defaultShouldDehydrateQuery,
  onlineManager,
  QueryClient,
} from '@tanstack/react-query';
import type { PersistQueryClientProviderProps } from '@tanstack/react-query-persist-client';
import { registerItemMutations } from '@/src/items/use-items';
import { registerListMutations } from '@/src/lists/use-lists';
import { registerLocationMutations } from '@/src/locations/use-locations';
import { cancelPendingRealtimeWork } from '@/src/realtime/apply-change';
import { queuedRetryDelay, shouldRetryQueued } from './queue-retry';
import { reprobeNow, setNetworkOnline } from './session-gate';

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY = 'cart-note-query-cache';
const OWNER_KEY = 'cart-note-cache-owner';

/** 모든 mutation 기본값(mutationFn 포함)을 등록한 QueryClient. 영속화된 mutation 재개에 필요하다. */
export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: DAY_MS, staleTime: 30_000, retry: 1 },
      // 오프라인 mutation을 재시작 후에도 보존하려면 gc되면 안 된다.
      // 세션 없음(SessionUnavailableError)은 실패가 아니라 pause로 보낸다(session-gate.ts).
      mutations: { gcTime: DAY_MS * 7, retry: shouldRetryQueued, retryDelay: queuedRetryDelay },
    },
  });
  registerItemMutations(client);
  registerListMutations(client);
  registerLocationMutations(client);
  return client;
}

export const queryClient = createQueryClient();

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: CACHE_KEY,
  throttleTime: 500,
});

export const persistOptions: PersistQueryClientProviderProps['persistOptions'] = {
  persister,
  // 오프라인 큐(mutation gcTime 7일)가 복원 시 통째로 버려지지 않도록 같은 기간으로 둔다.
  maxAge: DAY_MS * 7,
  buster: '1',
  dehydrateOptions: {
    // 온보딩 상태는 사용자/서버 상태에 따라 바뀌므로 디스크에 남기지 않는다.
    // 쓰기 큐(['m', …])만 영속화한다. 키 없는 mutation(예: 장소 검색)은 저장하지 않는다.
    shouldDehydrateMutation: (m) =>
      defaultShouldDehydrateMutation(m) && m.options.mutationKey?.[0] === 'm',
    shouldDehydrateQuery: (q) => defaultShouldDehydrateQuery(q) && q.queryKey[0] !== 'onboarding',
  },
};

/**
 * NetInfo 연결 상태를 세션 게이트에 연결한다. onlineManager는 게이트가 network && session으로 정한다
 * (세션 없이 큐가 재생되지 않게). 게이트가 닫힌 채로 시작하고, 소유자 확인 후 열린다.
 */
export function setupOnlineManager(): void {
  // 기본 리스너(window online/offline)가 게이트 값을 덮어쓰지 않게 비운다.
  onlineManager.setEventListener(() => () => {});
  setNetworkOnline(true);
  NetInfo.addEventListener((s) => setNetworkOnline(!!s.isConnected && s.isInternetReachable !== false));
  // 앱으로 돌아오면 서버 연결/세션을 바로 다시 확인한다(닫혀 있을 때만 실제로 확인한다).
  AppState.addEventListener('change', (s) => {
    if (s === 'active') void reprobeNow();
  });
}

/** 로그아웃/계정 전환 시 메모리와 디스크 캐시(오프라인 큐 포함)를 모두 지운다. */
export async function clearUserCache(client: QueryClient = queryClient): Promise<void> {
  // 예약된 Realtime 개수 갱신이 지운 뒤에 다시 조회하지 않게 한다.
  cancelPendingRealtimeWork(client);
  client.getMutationCache().clear();
  client.clear();
  await persister.removeClient();
}

/**
 * 디스크 캐시의 소유자를 기록하고, 현재 사용자와 다르면(로그아웃 포함) 캐시를 비운다.
 * 복원이 끝난 뒤 호출해야 이전 사용자의 캐시가 되살아나지 않는다.
 */
export async function syncCacheOwner(client: QueryClient, userId: string | null): Promise<void> {
  // 읽기 실패만 던진다(소유자를 모름 → 호출부가 재시도/대체 처리). 기록 실패는 무시한다:
  // 읽은 소유자가 현재 사용자면 캐시와 오프라인 큐가 이 사용자의 것이므로 지울 이유가 없다.
  const owner = await AsyncStorage.getItem(OWNER_KEY);
  // 로그아웃이거나 소유자가 현재 사용자가 아니면(소유자 기록이 없는 캐시 포함) 비운다.
  if (userId === null || owner !== userId) await clearUserCache(client);
  try {
    if (userId) {
      if (owner !== userId) await AsyncStorage.setItem(OWNER_KEY, userId);
    } else {
      await AsyncStorage.removeItem(OWNER_KEY);
    }
  } catch {
    // 다음 확인에서 다시 기록한다. 소유자 기록이 없으면 다음 확인이 캐시를 비우므로 남의 캐시가 남지 않는다.
  }
}
