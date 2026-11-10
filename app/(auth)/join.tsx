import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { GroupError, joinFamily, type GroupErrorCode } from '@/src/groups/group-api';
import { normalizeInviteCode } from '@/src/lib/text';
import { clearPendingInvite, getPendingInvite } from '@/src/onboarding/pending-invite';

const ERROR_MESSAGES: Partial<Record<GroupErrorCode, string>> = {
  invalid_code: '초대 코드를 찾을 수 없어요',
  already_member: '이미 참여한 그룹이에요',
  too_many_attempts: '잠시 후 다시 시도해 주세요',
  network: '연결을 확인해 주세요',
};

export default function Join() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(() => normalizeInviteCode(params.code ?? '') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 딥링크로 저장된 대기 코드 미리 채우기
  useEffect(() => {
    if (code) return;
    getPendingInvite().then((pending) => pending && setCode((c) => c || pending));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 앱이 열려 있는 동안 새 초대 링크가 오면 코드를 갱신
  useEffect(() => {
    const fromLink = normalizeInviteCode(params.code ?? '');
    if (fromLink) setCode(fromLink);
  }, [params.code]);

  const normalized = normalizeInviteCode(code);

  async function submit() {
    if (!normalized || busy) return;
    setBusy(true);
    setError(null);
    try {
      await joinFamily(normalized);
      await clearPendingInvite();
      router.replace('/');
    } catch (e) {
      const c = e instanceof GroupError ? e.code : 'network';
      if (c === 'already_member') await clearPendingInvite();
      setError(ERROR_MESSAGES[c] ?? ERROR_MESSAGES.network!);
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    await clearPendingInvite();
    router.replace('/');
  }

  return (
    <View className="flex-1 justify-center gap-4 bg-background px-6">
      <Text className="text-2xl font-bold">초대 코드로 참여하기</Text>
      <Input
        placeholder="000000"
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
      />
      <Button onPress={submit} disabled={!normalized || busy}>
        <Text>참여</Text>
      </Button>
      {error ? <Text className="text-destructive">{error}</Text> : null}
      <Button variant="ghost" onPress={skip}>
        <Text>나중에 할게요</Text>
      </Button>
    </View>
  );
}
