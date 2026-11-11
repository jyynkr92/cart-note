import * as Clipboard from 'expo-clipboard';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, Share, View } from 'react-native';
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
import { NearbyAlertToggle } from '@/src/geofence/NearbyAlertToggle';
import { signOut } from '@/src/auth/auth-api';
import { resolveCurrentFamily, useCurrentGroupStore } from '@/src/groups/current-group-store';
import { leaveFamily, regenerateInviteCode } from '@/src/groups/group-api';
import { useCurrentGroup, useFamilyMembers } from '@/src/groups/use-groups';
import { qk } from '@/src/lib/query-keys';
import { normalizeName } from '@/src/lib/text';
import { toast } from '@/src/lib/toast';
import { useTopInset } from '@/src/lib/use-top-inset';
import { updateDisplayName } from '@/src/onboarding/profile-api';

type Mode = 'regenerate' | 'leave' | 'name' | null;

export default function Settings() {
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { family, families, loading } = useCurrentGroup();
  const members = useFamilyMembers(family?.id ?? null);
  const { setFamilyId } = useCurrentGroupStore();
  const paddingTop = useTopInset();
  const [mode, setMode] = useState<Mode>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  // 나간 뒤에는 목록이 갱신되며 다른 그룹/빈 화면이 잠깐 비치지 않도록 계속 로딩을 보여 준다.
  const [leaving, setLeaving] = useState(false);

  if (leaving || !family) {
    return leaving || loading ? (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    ) : (
      <View className="flex-1 bg-background" />
    );
  }

  const inviteCode = family.invite_code;
  const trimmed = normalizeName(name);
  const myName = members.data?.find((m) => m.user_id === userId)?.display_name ?? '';

  async function copy() {
    await Clipboard.setStringAsync(inviteCode);
  }

  async function invite() {
    try {
      await Share.share({
        message: `Cart Note 초대 코드: ${inviteCode}\ncartnote://join?code=${inviteCode}`,
      });
    } catch {
      toast.error('공유하지 못했어요');
    }
  }

  async function run(fn: () => Promise<void>, failure: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setMode(null);
    } catch {
      toast.error(failure);
    } finally {
      setBusy(false);
    }
  }

  const regenerate = () =>
    run(async () => {
      await regenerateInviteCode(family!.id);
      await qc.invalidateQueries({ queryKey: qk.families() });
    }, '코드를 다시 만들지 못했어요');

  const saveName = () =>
    run(async () => {
      if (!trimmed || !userId) return;
      await updateDisplayName(userId, trimmed);
      await qc.invalidateQueries({ queryKey: ['members'] });
    }, '이름을 저장하지 못했어요');

  async function leave() {
    if (busy) return;
    setBusy(true);
    const leftId = family!.id;
    const remaining = families.filter((f) => f.id !== leftId);
    try {
      await leaveFamily(leftId);
    } catch {
      toast.error('그룹에서 나가지 못했어요');
      setBusy(false);
      return;
    }
    setLeaving(true);
    setMode(null);
    const next = resolveCurrentFamily(null, remaining);
    if (next) setFamilyId(next);
    await Promise.all([
      userId
        ? qc.invalidateQueries({ queryKey: qk.onboarding(userId), refetchType: 'all' })
        : undefined,
      qc.invalidateQueries({ queryKey: qk.families(), refetchType: 'all' }),
    ]);
    // 남은 그룹이 없으면 온보딩 가드가 개인 그룹 생성/참여 흐름으로 보낸다.
    if (next) router.replace('/');
  }

  async function logout() {
    try {
      await signOut();
    } catch {
      toast.error('로그아웃하지 못했어요');
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-4 pb-10"
      style={{ paddingTop }}>
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold">설정</Text>
        <Button variant="ghost" onPress={() => router.back()}>
          <Text>닫기</Text>
        </Button>
      </View>

      <View className="gap-3">
        <Text className="text-sm text-muted-foreground">{family.name} 초대 코드</Text>
        <Text className="text-3xl font-bold tracking-widest">{inviteCode}</Text>
        <View className="flex-row gap-2">
          <Button variant="outline" className="flex-1" onPress={() => void copy()}>
            <Text>복사</Text>
          </Button>
          <Button className="flex-1" onPress={() => void invite()}>
            <Text>가족 초대하기</Text>
          </Button>
        </View>
        <Button variant="ghost" onPress={() => setMode('regenerate')}>
          <Text>코드 재발급</Text>
        </Button>
      </View>

      <View className="gap-2">
        <Text className="text-sm text-muted-foreground">멤버</Text>
        {(members.data ?? []).map((m) => (
          <Text key={m.user_id}>{m.display_name ?? '이름 없음'}</Text>
        ))}
      </View>

      <View className="gap-2">
        <Text className="text-sm text-muted-foreground">위치 알림</Text>
        <NearbyAlertToggle />
      </View>

      <View className="gap-2">
        <Button
          variant="outline"
          onPress={() => {
            setName(myName);
            setMode('name');
          }}>
          <Text>내 이름 변경</Text>
        </Button>
        <Button variant="outline" onPress={() => setMode('leave')}>
          <Text>그룹 나가기</Text>
        </Button>
        <Button variant="ghost" onPress={() => void logout()}>
          <Text>로그아웃</Text>
        </Button>
      </View>

      <Dialog open={mode === 'regenerate'} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>초대 코드를 다시 만들까요?</DialogTitle>
          </DialogHeader>
          <Text>이전 코드는 더 이상 사용할 수 없어요.</Text>
          <DialogFooter>
            <Button variant="outline" onPress={() => setMode(null)}>
              <Text>취소</Text>
            </Button>
            <Button onPress={() => void regenerate()} disabled={busy}>
              <Text>재발급</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mode === 'leave'} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`'${family.name}' 그룹에서 나갈까요?`}</DialogTitle>
          </DialogHeader>
          <Text>마지막 멤버가 나가면 그룹과 목록이 삭제돼요.</Text>
          <DialogFooter>
            <Button variant="outline" onPress={() => setMode(null)}>
              <Text>취소</Text>
            </Button>
            <Button variant="destructive" onPress={() => void leave()} disabled={busy}>
              <Text>나가기</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mode === 'name'} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>내 이름 변경</DialogTitle>
          </DialogHeader>
          <Input placeholder="이름" value={name} onChangeText={setName} autoFocus />
          <DialogFooter>
            <Button onPress={() => void saveName()} disabled={!trimmed || busy}>
              <Text>저장</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollView>
  );
}
