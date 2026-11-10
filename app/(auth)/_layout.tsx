import { Redirect, Stack, useSegments } from 'expo-router';
import { useAuth } from '@/src/auth/AuthProvider';

export default function AuthLayout() {
  const { session, loading } = useAuth();
  const segments = useSegments() as string[];
  const onLogin = segments[segments.length - 1] === 'login';

  if (!loading) {
    // 로그인 전에는 login만, 로그인 후 login 화면은 홈 가드로 보낸다.
    if (!session && !onLogin) return <Redirect href="/login" />;
    if (session && onLogin) return <Redirect href="/" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
