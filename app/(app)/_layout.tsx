import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/auth/AuthProvider';
import { useOpenPendingNotification } from '@/src/geofence/notification-route';
import { useGeofenceSync } from '@/src/geofence/use-geofence-sync';
import { useCurrentFamily, useFamilies } from '@/src/groups/use-groups';
import { useIsOnline } from '@/src/lib/use-online';
import { useOnboarding } from '@/src/onboarding/use-onboarding';
import { useFamilyRealtime } from '@/src/realtime/use-family-realtime';

export default function AppLayout() {
  const { session, loading, offlineUserId } = useAuth();
  // 저장된 세션만 있고(오프라인 갱신 실패) 실제 세션이 없으면 서버에 묻지 않고 캐시로 판단한다.
  const sessionPending = !session && !!offlineUserId;
  const { step, pendingInvite, error, offline, retry } = useOnboarding(
    loading ? null : (session?.user.id ?? offlineUserId),
    { sessionPending }
  );
  const family = useCurrentFamily();
  useFamilyRealtime(step === 'ready' ? (family?.id ?? null) : null);
  const families = useFamilies().data;
  useGeofenceSync(step === 'ready');
  useOpenPendingNotification(step === 'ready', families);

  if (loading) return <Loading />;
  if (!session && !offlineUserId) return <Redirect href="/login" />;

  if (error) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-6">
        <Text>연결을 확인해 주세요</Text>
        <Button onPress={retry}>
          <Text>다시 시도</Text>
        </Button>
      </View>
    );
  }

  if (offline) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text>오프라인이라 확인할 수 없어요</Text>
      </View>
    );
  }

  switch (step) {
    case 'login':
      return <Redirect href="/login" />;
    case 'profile':
      return <Redirect href="/profile" />;
    case 'join-pending':
      return (
        <Redirect
          href={{ pathname: '/join', params: pendingInvite ? { code: pendingInvite } : {} }}
        />
      );
    case 'ready':
      return (
        <View className="flex-1 bg-background">
          <OfflineBanner />
          <Stack screenOptions={{ headerShown: false }} />
        </View>
      );
    default: // null(로딩), 'create-personal'(개인 그룹 생성 중)
      return <Loading />;
  }
}

/** 모든 (app) 화면 위에 노출된다. NetInfo가 onlineManager를 갱신한다. */
function OfflineBanner() {
  const online = useIsOnline();
  const { top } = useSafeAreaInsets();
  if (online) return null;
  return (
    <View className="bg-muted px-4 pb-2" style={{ paddingTop: top + 8 }}>
      <Text className="text-center text-sm text-muted-foreground">오프라인</Text>
    </View>
  );
}

function Loading() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator />
    </View>
  );
}
