import '@/global.css';

import { NAV_THEME } from '@/lib/theme';
import { useIsRestoring } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect } from 'react';
import { ThemeProvider } from 'expo-router/react-navigation';
import { PortalHost } from '@rn-primitives/portal';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { AuthProvider, useAuth } from '@/src/auth/AuthProvider';
import {
  persistOptions,
  queryClient,
  setupOnlineManager,
  syncCacheOwner,
} from '@/src/lib/query-client';
import { ToastHost } from '@/src/lib/toast';

setupOnlineManager();

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

/** 복원이 끝난 뒤, 디스크 캐시 소유자가 현재 사용자와 다르면(또는 로그아웃 상태면) 비운다. */
function CacheOwnerGuard() {
  const { session, loading } = useAuth();
  const restoring = useIsRestoring();
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (restoring || loading) return;
    // 소유자 확인이 끝난 뒤에만 대기 중인 mutation을 재개한다(다른 사용자의 큐가 실행되지 않도록).
    syncCacheOwner(queryClient, userId)
      .then(() => queryClient.resumePausedMutations())
      .catch(() => {});
  }, [restoring, loading, userId]);
  return null;
}

function RootNavigator() {
  const { loading } = useAuth();

  if (loading) return null;

  // 인증/온보딩 리다이렉트는 (auth)/_layout, (app)/_layout 가드가 담당한다.
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(app)" />
      <Stack.Screen name="(auth)" />
    </Stack>
  );
}

export default function RootLayout() {
  const { colorScheme } = useColorScheme();

  return (
    <ThemeProvider value={NAV_THEME[colorScheme ?? 'light']}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={persistOptions}>
        <AuthProvider>
          <CacheOwnerGuard />
          <RootNavigator />
        </AuthProvider>
      </PersistQueryClientProvider>
      <PortalHost />
      <ToastHost />
    </ThemeProvider>
  );
}
