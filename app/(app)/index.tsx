import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Settings } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Sheet, SheetFooter, SheetHeader, SheetInput, SheetTitle } from '@/components/ui/sheet';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/src/auth/AuthProvider';
import { GroupSwitcher } from '@/src/groups/GroupSwitcher';
import { useCurrentGroup, useFamilyMembers } from '@/src/groups/use-groups';
import { ListCard, sortLists } from '@/src/lists/ListCard';
import { useCreateList, useLists } from '@/src/lists/use-lists';
import { qk } from '@/src/lib/query-keys';
import { MAX_LENGTH, normalizeName } from '@/src/lib/text';
import { useTopInset } from '@/src/lib/use-top-inset';

type NewKind = 'store' | 'online';

export default function Home() {
  const router = useRouter();
  const qc = useQueryClient();
  const { session, offlineUserId } = useAuth();
  // 오프라인 사용자 모드(저장된 세션만 있음)에서도 내 id를 쓴다.
  const userId = session?.user.id ?? offlineUserId;
  const { family, families, loading } = useCurrentGroup();
  const familyId = family?.id ?? null;
  const lists = useLists(familyId);
  const members = useFamilyMembers(familyId);
  const createList = useCreateList();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<NewKind>('store');
  const paddingTop = useTopInset();

  // 그룹이 없으면 보통 온보딩 가드가 개인 그룹 생성/참여 화면으로 보낸다.
  // 그 생성이 실패하면(예: 마지막 그룹을 나간 직후 오프라인) 가드는 이전 'ready'에 머무르므로 여기서 복구할 길을 준다.
  if (!family) {
    if (loading) {
      return (
        <View className="flex-1 items-center justify-center bg-background">
          <ActivityIndicator />
        </View>
      );
    }
    const retry = () =>
      void Promise.all([
        userId
          ? qc.invalidateQueries({ queryKey: qk.onboarding(userId), refetchType: 'all' })
          : undefined,
        qc.invalidateQueries({ queryKey: qk.families(), refetchType: 'all' }),
      ]);
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-6">
        <Text>그룹을 불러오지 못했어요</Text>
        <Button onPress={retry}>
          <Text>다시 시도</Text>
        </Button>
        <Button variant="ghost" accessibilityLabel="설정" onPress={() => router.push('/settings')}>
          <Text>설정</Text>
        </Button>
      </View>
    );
  }

  const trimmed = normalizeName(name);

  function openAdd() {
    setName('');
    setKind('store');
    setAdding(true);
  }

  function save() {
    if (!trimmed || !familyId) return;
    createList.mutate({ familyId, name: trimmed, kind });
    setAdding(false);
  }

  return (
    <View className="flex-1 gap-4 bg-background px-4" style={{ paddingTop }}>
      <View className="flex-row items-center justify-between">
        <GroupSwitcher family={family} families={families} />
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel="설정"
          onPress={() => router.push('/settings')}>
          <Icon as={Settings} className="size-5" />
        </Button>
      </View>
      {lists.isPending && lists.fetchStatus === 'paused' ? (
        <View className="flex-1 items-center justify-center">
          <Text>오프라인이라 불러올 수 없어요</Text>
        </View>
      ) : lists.isError && !lists.data ? (
        <View className="flex-1 items-center justify-center gap-4">
          <Text>불러오지 못했어요</Text>
          <Button onPress={() => void lists.refetch()}>
            <Text>다시 시도</Text>
          </Button>
        </View>
      ) : (
        <ScrollView contentContainerClassName="gap-3 pb-6">
          {sortLists(lists.data ?? []).map((item) => (
            <ListCard
              key={item.id}
              list={item}
              onPress={() => router.push({ pathname: '/list/[id]', params: { id: item.id } })}
            />
          ))}
          <View className="gap-4">
            <Button variant="outline" onPress={openAdd}>
              <Text>+ 목록 추가</Text>
            </Button>
            {members.data?.length === 1 ? (
              <Text className="text-center text-sm text-muted-foreground">
                가족을 초대해 함께 써보세요
              </Text>
            ) : null}
          </View>
        </ScrollView>
      )}

      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetHeader>
          <SheetTitle>목록 추가</SheetTitle>
        </SheetHeader>
        <SheetInput
          placeholder="목록 이름"
          value={name}
          onChangeText={setName}
          maxLength={MAX_LENGTH.listName}
          autoFocus
        />
        <View className="flex-row gap-2" accessibilityRole="radiogroup">
          <Button
            variant={kind === 'store' ? 'default' : 'outline'}
            className="flex-1"
            // Button이 role="button"을 넣으므로 role도 덮어써야 radio로 읽힌다.
            role="radio"
            accessibilityRole="radio"
            accessibilityState={{ selected: kind === 'store' }}
            onPress={() => setKind('store')}>
            <Text>마트</Text>
          </Button>
          <Button
            variant={kind === 'online' ? 'default' : 'outline'}
            className="flex-1"
            role="radio"
            accessibilityRole="radio"
            accessibilityState={{ selected: kind === 'online' }}
            onPress={() => setKind('online')}>
            <Text>사이트</Text>
          </Button>
        </View>
        <SheetFooter>
          <Button onPress={save} disabled={!trimmed}>
            <Text>저장</Text>
          </Button>
        </SheetFooter>
      </Sheet>
    </View>
  );
}
