import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Settings } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListDragEndEvent,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';
import { scheduleOnRN } from 'react-native-worklets';
import { Button } from '@/components/ui/button';
import { Sheet, SheetFooter, SheetHeader, SheetInput, SheetTitle } from '@/components/ui/sheet';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/src/auth/AuthProvider';
import { GroupSwitcher } from '@/src/groups/GroupSwitcher';
import { useCurrentGroup, useFamilyMembers } from '@/src/groups/use-groups';
import { ListCard, moveId, sortLists, type MoveActions } from '@/src/lists/ListCard';
import type { List } from '@/src/lists/list-api';
import { useCreateList, useLists, useReorderLists } from '@/src/lists/use-lists';
import { qk } from '@/src/lib/query-keys';
import { MAX_LENGTH, normalizeName } from '@/src/lib/text';
import { useTopInset } from '@/src/lib/use-top-inset';

type NewKind = 'store' | 'online';

/** 끌 수 있는 목록 카드. 길게 누르면 집고, 짧게 누르면 상세로 간다. */
function DraggableListCard({
  list,
  onPress,
  move,
}: {
  list: List;
  onPress: () => void;
  move: MoveActions;
}) {
  const drag = useReorderableDrag();
  return (
    <View className="pb-3">
      <ListCard list={list} onPress={onPress} onLongPress={drag} move={move} />
    </View>
  );
}

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
  const reorderLists = useReorderLists();
  // 놓은 순간의 새 순서. onMutate가 캐시를 바꾸기 전(비동기) 한 번이라도 옛 순서로 돌아가 보이지 않도록,
  // 놓을 때의 캐시 데이터(base)가 그대로인 동안만 이 순서로 그린다. 캐시가 바뀌면(낙관적 반영, 롤백, 재조회) 버린다.
  // 끄는 동안 목록에 그릴 데이터. 끄는 사이 다른 가족의 변경으로 재조회가 와도 라이브러리의 from·to·집힌 카드가
  // 모두 같은 순서를 가리키도록, 집은 순간의 목록으로 고정했다가 놓은 결과를 처리하거나 제자리에 놓으면 푼다.
  // (그사이 생긴 목록은 서버와 낙관적 반영이 뒤에 붙이고, 지워진 목록은 건너뛴다.)
  const [frozen, setFrozenState] = useState<List[] | null>(null);
  const frozenRef = useRef<List[] | null>(null);
  const [dropped, setDropped] = useState<{ base: List[] | undefined; ids: string[] } | null>(null);
  if (dropped && dropped.base !== lists.data) setDropped(null);
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
  const sorted = sortLists(lists.data ?? []);
  const inbox = sorted.filter((l) => l.kind === 'inbox');
  let movable = sorted.filter((l) => l.kind !== 'inbox');
  if (dropped && dropped.base === lists.data) {
    const byId = new Map(movable.map((l) => [l.id, l]));
    movable = dropped.ids.flatMap((id) => byId.get(id) ?? []);
  }
  const open = (id: string) => router.push({ pathname: '/list/[id]', params: { id } });

  const shown = frozen ?? movable;
  function setFrozen(next: List[] | null) {
    frozenRef.current = next;
    setFrozenState(next);
  }
  const freeze = () => setFrozen(movable);
  const unfreeze = () => setFrozen(null);
  // 라이브러리의 끌기 이벤트는 UI 스레드(worklet)에서 오므로 JS로 넘긴다. 실제로 끌기가 시작될 때만 온다.
  const onDragStart = () => {
    'worklet';
    scheduleOnRN(freeze);
  };
  const onDragEnd = ({ from, to }: ReorderableListDragEndEvent) => {
    'worklet';
    // 자리를 옮겼으면 onReorder가 뒤따르므로 거기서 푼다. 여기서 풀면 그 전에 데이터가 바뀐다.
    if (from === to) scheduleOnRN(unfreeze);
  };

  function reorder({ from, to }: ReorderableListReorderEvent) {
    const base = (frozenRef.current ?? movable).map((l) => l.id);
    if (frozenRef.current) setFrozen(null);
    const n = base.length;
    if (from === to || !familyId || from < 0 || from >= n) return;
    const ids = moveId(base, from, Math.min(Math.max(to, 0), n - 1));
    setDropped({ base: lists.data, ids });
    reorderLists.mutate({ familyId, ids });
  }

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
        // 카드 사이 간격은 셀 안의 pb-3으로 준다(라이브러리가 셀 높이로 끌 자리를 계산하므로 gap을 쓰지 않는다).
        <ReorderableList
          data={shown}
          keyExtractor={(item) => item.id}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onReorder={reorder}
          renderItem={({ item, index }) => (
            <DraggableListCard
              list={item}
              onPress={() => open(item.id)}
              move={{
                up: index > 0,
                down: index < shown.length - 1,
                onMove: (delta) => reorder({ from: index, to: index + delta }),
              }}
            />
          )}
          ListHeaderComponent={
            <>
              {inbox.map((item) => (
                <View key={item.id} className="pb-3">
                  <ListCard list={item} onPress={() => open(item.id)} />
                </View>
              ))}
            </>
          }
          ListFooterComponent={
            <View className="gap-4 pb-6">
              <Button variant="outline" onPress={openAdd}>
                <Text>+ 목록 추가</Text>
              </Button>
              {members.data?.length === 1 ? (
                <Text className="text-center text-sm text-muted-foreground">
                  가족을 초대해 함께 써보세요
                </Text>
              ) : null}
            </View>
          }
        />
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
            <Text>온라인</Text>
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
