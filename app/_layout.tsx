import '@/global.css';

import { NAV_THEME } from '@/lib/theme';
import { useIsRestoring } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect } from 'react';
import { ThemeProvider } from 'expo-router/react-navigation';
import { PortalHost } from '@rn-primitives/portal';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { AuthProvider, useAuth } from '@/src/auth/AuthProvider';
// 지오펜스 작업 정의는 index.ts 진입점이 먼저 등록한다. 여기서의 import는 중복이어도 무해하다(모듈은 한 번만 평가).
import '@/src/geofence/geofence-task';
import {
  setupNotificationHandler,
  useNotificationResponses,
} from '@/src/geofence/notification-route';
import {
  persistOptions,
  queryClient,
  setupOnlineManager,
  syncCacheOwner,
} from '@/src/lib/query-client';
import { ToastHost } from '@/src/lib/toast';

setupOnlineManager();
setupNotificationHandler();

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
  // 알림 탭은 여기서 기록만 하고, 실제 이동은 (app) 가드가 ready가 된 뒤 (app)/_layout이 한다.
  useNotificationResponses();

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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={NAV_THEME[colorScheme ?? 'light']}>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <AuthProvider>
            <CacheOwnerGuard />
            <RootNavigator />
          </AuthProvider>
        </PersistQueryClientProvider>
        <PortalHost />
        <ToastHost />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
