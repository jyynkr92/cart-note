import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/src/auth/AuthProvider';
import { useOnboarding } from '@/src/onboarding/use-onboarding';

export default function AppLayout() {
  const { session, loading } = useAuth();
  const { step, pendingInvite, error, retry } = useOnboarding(loading ? null : (session?.user.id ?? null));

  if (loading) return <Loading />;
  if (!session) return <Redirect href="/login" />;

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

  switch (step) {
    case 'login':
      return <Redirect href="/login" />;
    case 'profile':
      return <Redirect href="/profile" />;
    case 'join-pending':
      return (
        <Redirect href={{ pathname: '/join', params: pendingInvite ? { code: pendingInvite } : {} }} />
      );
    case 'ready':
      return <Stack screenOptions={{ headerShown: false }} />;
    default: // null(로딩), 'create-personal'(개인 그룹 생성 중)
      return <Loading />;
  }
}

function Loading() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator />
    </View>
  );
}
