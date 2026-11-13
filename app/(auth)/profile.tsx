import { useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/src/auth/AuthProvider';
import { qk } from '@/src/lib/query-keys';
import { MAX_LENGTH, normalizeName } from '@/src/lib/text';
import { createProfile } from '@/src/onboarding/profile-api';

export default function Profile() {
  const { session } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = normalizeName(name);

  async function submit() {
    if (!normalized || !session || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createProfile(session.user.id, normalized);
      // 가드가 새 상태를 보기 전에 갱신(비활성 쿼리도 다시 가져옴)해서 /profile로 되돌아가지 않게 한다.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: qk.onboarding(session.user.id),
          refetchType: 'all',
        }),
        queryClient.invalidateQueries({ queryKey: qk.families(), refetchType: 'all' }),
      ]);
      router.replace('/');
    } catch {
      setError('저장하지 못했어요. 연결을 확인해 주세요');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 justify-center gap-4 bg-background px-6">
      <Text className="text-2xl font-bold">이름을 알려 주세요</Text>
      <Input placeholder="이름" value={name} onChangeText={setName} maxLength={MAX_LENGTH.displayName} />
      <Button onPress={submit} disabled={!normalized || busy}>
        <Text>시작하기</Text>
      </Button>
      {error ? <Text className="text-destructive">{error}</Text> : null}
      <Link href="/join" asChild>
        <Button variant="ghost">
          <Text>초대 코드가 있나요?</Text>
        </Button>
      </Link>
    </View>
  );
}
