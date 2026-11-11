import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
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
import { GroupSwitcher } from '@/src/groups/GroupSwitcher';
import { useCurrentGroup, useFamilyMembers } from '@/src/groups/use-groups';
import { ListCard, sortLists } from '@/src/lists/ListCard';
import { useCreateList, useLists } from '@/src/lists/use-lists';
import { normalizeName } from '@/src/lib/text';

type NewKind = 'store' | 'online';

export default function Home() {
  const router = useRouter();
  const { family, families, loading } = useCurrentGroup();
  const familyId = family?.id ?? null;
  const lists = useLists(familyId);
  const members = useFamilyMembers(familyId);
  const createList = useCreateList();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<NewKind>('store');

  // 그룹이 없으면 온보딩 가드가 개인 그룹 생성/참여 화면으로 보낸다.
  if (!family) {
    return loading ? (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    ) : (
      <View className="flex-1 bg-background" />
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
    <View className="flex-1 gap-4 bg-background px-4 pt-16">
      <GroupSwitcher family={family} families={families} />
      <ScrollView contentContainerClassName="gap-3 pb-6">
        {sortLists(lists.data ?? []).map((item) => (
          <ListCard
            key={item.id}
            list={item}
            // 목록 상세 라우트(app/(app)/list/[id])는 다음 태스크에서 만든다. 그 전까지 typed routes에 없다.
            onPress={() =>
              router.push({ pathname: '/list/[id]', params: { id: item.id } } as unknown as Href)
            }
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

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>목록 추가</DialogTitle>
          </DialogHeader>
          <Input placeholder="목록 이름" value={name} onChangeText={setName} autoFocus />
          <View className="flex-row gap-2">
            <Button
              variant={kind === 'store' ? 'default' : 'outline'}
              className="flex-1"
              onPress={() => setKind('store')}>
              <Text>마트</Text>
            </Button>
            <Button
              variant={kind === 'online' ? 'default' : 'outline'}
              className="flex-1"
              onPress={() => setKind('online')}>
              <Text>사이트</Text>
            </Button>
          </View>
          <DialogFooter>
            <Button onPress={save} disabled={!trimmed}>
              <Text>저장</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </View>
  );
}
