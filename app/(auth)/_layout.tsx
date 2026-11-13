import { Redirect, Stack, useSegments } from 'expo-router';
import { useAuth } from '@/src/auth/AuthProvider';

export default function AuthLayout() {
  const { session, loading, offlineUserId } = useAuth();
  // 저장된 세션만 있는 오프라인 사용자도 로그인 상태로 본다(B1).
  const signedIn = !!session || !!offlineUserId;
  const segments = useSegments() as string[];
  const onLogin = segments[segments.length - 1] === 'login';

  if (!loading) {
    // 로그인 전에는 login만, 로그인 후 login 화면은 홈 가드로 보낸다.
    if (!signedIn && !onLogin) return <Redirect href="/login" />;
    if (signedIn && onLogin) return <Redirect href="/" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
