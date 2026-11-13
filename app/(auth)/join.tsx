import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/src/auth/AuthProvider';
import { useCurrentGroupStore } from '@/src/groups/current-group-store';
import { loadEmptySoloGroups } from '@/src/groups/empty-group-cleanup';
import { GroupError, joinFamily, leaveFamily, type GroupErrorCode } from '@/src/groups/group-api';
import { mk, qk } from '@/src/lib/query-keys';
import { INVITE_CODE_LENGTH, normalizeInviteCode } from '@/src/lib/text';
import { toast } from '@/src/lib/toast';
import { clearPendingInvite, getPendingInvite } from '@/src/onboarding/pending-invite';

const ERROR_MESSAGES: Partial<Record<GroupErrorCode, string>> = {
  invalid_code: '초대 코드를 찾을 수 없어요',
  already_member: '이미 참여한 그룹이에요',
  too_many_attempts: '잠시 후 다시 시도해 주세요',
  network: '연결을 확인해 주세요',
};

export default function Join() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { setFamilyId } = useCurrentGroupStore();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(() => normalizeInviteCode(params.code ?? '') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 참여 후 정리를 물어볼 빈 개인 그룹(하나씩 차례로 묻는다)
  const [cleanup, setCleanup] = useState<Array<{ id: string; name: string }>>([]);

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

  async function refreshOnboarding() {
    await Promise.all([
      session
        ? queryClient.invalidateQueries({
            queryKey: qk.onboarding(session.user.id),
            refetchType: 'all',
          })
        : undefined,
      queryClient.invalidateQueries({ queryKey: qk.families(), refetchType: 'all' }),
    ]);
  }

  async function finish() {
    await refreshOnboarding();
    router.replace('/');
  }

  async function answer(remove: boolean) {
    const [current, ...rest] = cleanup;
    if (!current || busy) return;
    setBusy(true);
    try {
      try {
        if (remove) await leaveFamily(current.id);
      } catch {
        // 정리는 부가 기능이라 실패해도 알리고 계속 진행한다.
        toast.error('그룹을 삭제하지 못했어요');
      }
      setCleanup(rest);
      if (!rest.length) await finish();
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!normalized || busy) return;
    setBusy(true);
    setError(null);
    try {
      const joinedId = await joinFamily(normalized);
      setFamilyId(joinedId);
      await clearPendingInvite();
      // 오프라인 큐에 쓰기가 남아 있으면 서버에는 아직 비어 보일 수 있으므로 정리를 묻지 않는다.
      const queued = queryClient.isMutating({ mutationKey: mk.all }) > 0;
      const empties = queued ? [] : await loadEmptySoloGroups(joinedId);
      if (empties.length) setCleanup(empties);
      else await finish();
    } catch (e) {
      const c = e instanceof GroupError ? e.code : 'network';
      if (c === 'already_member' || c === 'invalid_code') await clearPendingInvite();
      setError(ERROR_MESSAGES[c] ?? ERROR_MESSAGES.network!);
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    await clearPendingInvite();
    await refreshOnboarding();
    // 그룹이 없어 개인 그룹을 만들다 실패했으면 빈 홈으로 가지 않고 여기 머문다.
    if (session && queryClient.getQueryState(qk.onboarding(session.user.id))?.status === 'error') {
      toast.error('새 그룹을 준비하지 못했어요');
      return;
    }
    router.replace('/');
  }

  return (
    <View className="flex-1 justify-center gap-4 bg-background px-6">
      <Text className="text-2xl font-bold">초대 코드로 참여하기</Text>
      <Input
        placeholder="00000000"
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, INVITE_CODE_LENGTH))}
        keyboardType="number-pad"
        maxLength={INVITE_CODE_LENGTH}
      />
      {error ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      ) : null}
      <Button onPress={submit} disabled={!normalized || busy}>
        <Text>참여</Text>
      </Button>
      <Button variant="ghost" onPress={skip}>
        <Text>나중에 할게요</Text>
      </Button>
      <Dialog open={cleanup.length > 0} onOpenChange={(open) => !open && void answer(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`비어 있는 '${cleanup[0]?.name ?? ''}' 그룹을 삭제할까요?`}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onPress={() => void answer(false)}>
              <Text>유지</Text>
            </Button>
            <Button variant="destructive" onPress={() => void answer(true)}>
              <Text>삭제</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </View>
  );
}
