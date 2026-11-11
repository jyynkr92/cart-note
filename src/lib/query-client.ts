import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateQuery, onlineManager, QueryClient } from '@tanstack/react-query';
import type { PersistQueryClientProviderProps } from '@tanstack/react-query-persist-client';
import { registerItemMutations } from '@/src/items/use-items';
import { registerListMutations } from '@/src/lists/use-lists';

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY = 'cart-note-query-cache';
const OWNER_KEY = 'cart-note-cache-owner';

/** 모든 mutation 기본값(mutationFn 포함)을 등록한 QueryClient. 영속화된 mutation 재개에 필요하다. */
export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: DAY_MS, staleTime: 30_000, retry: 1 },
      // 오프라인 mutation을 재시작 후에도 보존하려면 gc되면 안 된다.
      mutations: { gcTime: DAY_MS * 7 },
    },
  });
  registerItemMutations(client);
  registerListMutations(client);
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
  maxAge: DAY_MS,
  buster: '1',
  dehydrateOptions: {
    // 온보딩 상태는 사용자/서버 상태에 따라 바뀌므로 디스크에 남기지 않는다.
    shouldDehydrateQuery: (q) => defaultShouldDehydrateQuery(q) && q.queryKey[0] !== 'onboarding',
  },
};

/** NetInfo 연결 상태를 TanStack Query의 onlineManager에 연결한다. */
export function setupOnlineManager(): void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false))
  );
}

/** 로그아웃/계정 전환 시 메모리와 디스크 캐시(오프라인 큐 포함)를 모두 지운다. */
export async function clearUserCache(client: QueryClient = queryClient): Promise<void> {
  client.getMutationCache().clear();
  client.clear();
  await persister.removeClient();
}

/**
 * 디스크 캐시의 소유자를 기록하고, 현재 사용자와 다르면(로그아웃 포함) 캐시를 비운다.
 * 복원이 끝난 뒤 호출해야 이전 사용자의 캐시가 되살아나지 않는다.
 */
export async function syncCacheOwner(client: QueryClient, userId: string | null): Promise<void> {
  const owner = await AsyncStorage.getItem(OWNER_KEY);
  // 로그아웃이거나 다른 사용자의 캐시일 때만 비운다(같은 사용자의 재로그인은 유지).
  if (userId === null || (owner !== null && owner !== userId)) await clearUserCache(client);
  if (userId) await AsyncStorage.setItem(OWNER_KEY, userId);
  else await AsyncStorage.removeItem(OWNER_KEY);
}
