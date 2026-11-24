import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, View } from 'react-native';
import { Button } from '@/components/ui/button';
import {
  ConfirmSheet,
  MenuSheet,
  Sheet,
  SheetFooter,
  SheetHeader,
  SheetInput,
  SheetTitle,
  useLastWhileOpen,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useCurrentGroup } from '@/src/groups/use-groups';
import { ItemEditSheet } from '@/src/items/ItemEditSheet';
import { ItemRow } from '@/src/items/ItemRow';
import { MoveSheet } from '@/src/items/MoveSheet';
import type { Item } from '@/src/items/item-api';
import { sortItems } from '@/src/items/sort-items';
import {
  useAddItem,
  useClearDone,
  useClearList,
  useDeleteItems,
  useItems,
  useMoveItems,
  useToggleItem,
  useUpdateItem,
} from '@/src/items/use-items';
import { MAX_LENGTH, normalizeName } from '@/src/lib/text';
import { useSelection } from '@/src/items/use-selection';
import { useTopInset } from '@/src/lib/use-top-inset';
import { useDeleteList, useLists, useRenameList } from '@/src/lists/use-lists';

type Mode = 'rename' | 'clear' | 'delete' | 'deleteSelected' | 'move' | null;

export default function ListDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const paddingTop = useTopInset();
  const { family, loading } = useCurrentGroup();
  const familyId = family?.id ?? null;
  const lists = useLists(familyId);
  const list = lists.data?.find((l) => l.id === id);
  const items = useItems(list?.id);

  const addItem = useAddItem();
  const toggleItem = useToggleItem();
  const updateItem = useUpdateItem();
  const deleteItems = useDeleteItems();
  const moveItems = useMoveItems();
  const clearDone = useClearDone();
  const clearList = useClearList();
  const renameList = useRenameList();
  const deleteList = useDeleteList();

  const [text, setText] = useState('');
  const [editing, setEditing] = useState<Item | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [listName, setListName] = useState('');
  // 삭제 직후 캐시에서 목록이 먼저 사라져도 "찾을 수 없어요"가 깜빡이지 않게 한다.
  const [deleting, setDeleting] = useState(false);

  const selection = useSelection();
  const { retain, clear: clearSelection } = selection;
  const itemIds = items.data?.map((i) => i.id);

  // 선택한 항목이 사라지면(예: 실시간 삭제) 선택에서 뺀다. 목록이 바뀌면 선택을 초기화한다.
  useEffect(() => {
    if (itemIds) retain(itemIds);
  }, [itemIds?.join(','), retain]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    clearSelection();
    setMode((m) => (m === 'move' || m === 'deleteSelected' ? null : m));
  }, [id, clearSelection]);
  // 선택이 비면(예: 실시간 삭제) 선택 항목용 이동/삭제 대화상자도 닫는다.
  useEffect(() => {
    if (!selection.active) setMode((m) => (m === 'move' || m === 'deleteSelected' ? null : m));
  }, [selection.active]);
  // 하드웨어 뒤로가기는 선택 모드부터 끝낸다.
  useEffect(() => {
    if (!selection.active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      clearSelection();
      return true;
    });
    return () => sub.remove();
  }, [selection.active, clearSelection]);

  // 현재 목록에 실제로 있는 항목만 보낸다.
  const selectedIds = (items.data ?? [])
    .filter((i) => selection.selected.has(i.id))
    .map((i) => i.id);
  // 삭제를 확인하면 선택을 비우며 시트를 닫는다. 닫는 동안에는 확인했던 개수를 보인다.
  const deleteCount = useLastWhileOpen(selectedIds.length, mode === 'deleteSelected');

  const goHome = () => router.replace('/');
  const wrap = (children: React.ReactNode) => (
    <View className="flex-1 bg-background px-4" style={{ paddingTop }}>
      {children}
    </View>
  );

  if (deleting) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  if (family && lists.isPending && lists.fetchStatus === 'paused') {
    return wrap(<OfflineState />);
  }
  if (!family || (lists.isPending && !lists.isError)) {
    return !family && !loading ? (
      <View className="flex-1 bg-background" />
    ) : (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  if (!lists.data) {
    return wrap(<ErrorState onRetry={() => void lists.refetch()} />);
  }
  if (!list) {
    return wrap(
      <View className="flex-1 items-center justify-center gap-4">
        <Text>목록을 찾을 수 없어요</Text>
        <Button onPress={goHome}>
          <Text>홈으로</Text>
        </Button>
      </View>
    );
  }

  const listId = list.id;
  const { open, done } = sortItems(items.data ?? []);
  const renameTrimmed = normalizeName(listName);

  function submit() {
    if (!familyId) return;
    addItem.mutate({ listId, familyId, name: text });
    setText('');
  }

  const moveTargets = (lists.data ?? []).filter((l) => l.id !== listId);

  function confirmMove(toListId: string) {
    if (selectedIds.length > 0)
      moveItems.mutate({ fromListId: listId, toListId, ids: selectedIds });
    selection.clear();
    setMode(null);
  }

  function confirmDeleteSelected() {
    if (selectedIds.length > 0) deleteItems.mutate({ listId, ids: selectedIds });
    selection.clear();
    setMode(null);
  }

  function openRename() {
    setListName(list!.name);
    setMode('rename');
  }

  function saveRename() {
    if (!renameTrimmed || !familyId) return;
    renameList.mutate({ id: listId, familyId, name: renameTrimmed });
    setMode(null);
  }

  function confirmClear() {
    clearList.mutate({ listId });
    setMode(null);
  }

  function confirmDelete() {
    setMode(null);
    if (!familyId) return;
    setDeleting(true);
    deleteList.mutate({ id: listId, familyId });
    goHome();
  }

  return wrap(
    <>
      {selection.active ? (
        <View className="flex-row items-center justify-between gap-2 pb-3">
          <Text className="flex-1 text-xl font-bold">{`${selectedIds.length}개 선택됨`}</Text>
          <Button variant="ghost" accessibilityLabel="선택 취소" onPress={selection.clear}>
            <Text>취소</Text>
          </Button>
          <Button
            variant="ghost"
            accessibilityLabel="선택 항목 이동"
            onPress={() => setMode('move')}>
            <Text>이동</Text>
          </Button>
          <Button
            variant="ghost"
            accessibilityLabel="선택 항목 삭제"
            onPress={() => setMode('deleteSelected')}>
            <Text className="text-destructive">삭제</Text>
          </Button>
        </View>
      ) : (
        <View className="flex-row items-center justify-between gap-2 pb-3">
          <View className="flex-1 flex-row items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              accessibilityLabel="뒤로"
              onPress={() => router.back()}>
              <Text>‹</Text>
            </Button>
            <Text className="flex-1 text-xl font-bold" numberOfLines={1}>
              {list.name}
            </Text>
          </View>
          <MenuSheet
            trigger={(show) => (
              <Button variant="ghost" size="icon" accessibilityLabel="목록 메뉴" onPress={show}>
                <Text>⋯</Text>
              </Button>
            )}
            items={[
              {
                label: '완료 항목 지우기',
                disabled: done.length === 0,
                onPress: () => clearDone.mutate({ listId }),
              },
              {
                label: '목록 비우기',
                // 항목을 불러오기 전에는 지울 대상(id)을 알 수 없다.
                disabled: !items.data?.length,
                onPress: () => setMode('clear'),
              },
              'separator',
              { label: '이름 변경', onPress: openRename },
              ...(list.kind === 'store'
                ? [
                    {
                      label: '지점 관리',
                      onPress: () =>
                        router.push({ pathname: '/list/[id]/locations', params: { id: listId } }),
                    },
                  ]
                : []),
              ...(list.kind !== 'inbox'
                ? [{ label: '목록 삭제', onPress: () => setMode('delete') }]
                : []),
            ]}
          />
        </View>
      )}

      <Input
        placeholder="항목 추가"
        value={text}
        onChangeText={setText}
        onSubmitEditing={submit}
        maxLength={MAX_LENGTH.itemName}
        // 'submit'이면 제출 후에도 키보드/포커스가 유지돼 연속으로 입력할 수 있다.
        submitBehavior="submit"
        returnKeyType="done"
      />

      {items.isPending && items.fetchStatus === 'paused' ? (
        <OfflineState />
      ) : items.isError && !items.data ? (
        <ErrorState onRetry={() => void items.refetch()} />
      ) : items.isPending ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView
          className="mt-2"
          contentContainerClassName="pb-6"
          keyboardShouldPersistTaps="handled">
          {open.map((i) => (
            <ItemRow
              key={i.id}
              item={i}
              onToggle={(it) => toggleItem.mutate({ item: it })}
              onPress={setEditing}
              onDelete={(it) => deleteItems.mutate({ listId, ids: [it.id] })}
              selecting={selection.active}
              selected={selection.selected.has(i.id)}
              onLongPress={(it) => selection.start(it.id)}
              onSelectToggle={(it) => selection.toggle(it.id)}
            />
          ))}
          {done.length > 0 ? (
            <View className="mt-4">
              <Text className="px-4 pb-1 text-sm font-medium text-muted-foreground">
                {`완료됨 (${done.length})`}
              </Text>
              {done.map((i) => (
                <ItemRow
                  key={i.id}
                  item={i}
                  onToggle={(it) => toggleItem.mutate({ item: it })}
                  onPress={setEditing}
                  onDelete={(it) => deleteItems.mutate({ listId, ids: [it.id] })}
                  selecting={selection.active}
                  selected={selection.selected.has(i.id)}
                  onLongPress={(it) => selection.start(it.id)}
                  onSelectToggle={(it) => selection.toggle(it.id)}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}

      <ItemEditSheet
        item={editing}
        onClose={() => setEditing(null)}
        onSave={(input) => {
          updateItem.mutate(input);
          setEditing(null);
        }}
      />

      <MoveSheet
        open={mode === 'move'}
        lists={moveTargets}
        onClose={() => setMode(null)}
        onSelect={confirmMove}
      />

      <ConfirmSheet
        open={mode === 'deleteSelected'}
        title="항목 삭제"
        description={`${deleteCount}개 항목을 삭제할까요?`}
        confirmLabel="삭제"
        destructive
        onConfirm={confirmDeleteSelected}
        onCancel={() => setMode(null)}
      />

      <Sheet open={mode === 'rename'} onOpenChange={(o) => !o && setMode(null)}>
        <SheetHeader>
          <SheetTitle>목록 이름 변경</SheetTitle>
        </SheetHeader>
        <SheetInput
          placeholder="목록 이름"
          value={listName}
          onChangeText={setListName}
          maxLength={MAX_LENGTH.listName}
          autoFocus
        />
        <SheetFooter>
          <Button onPress={saveRename} disabled={!renameTrimmed}>
            <Text>저장</Text>
          </Button>
        </SheetFooter>
      </Sheet>

      <ConfirmSheet
        open={mode === 'clear'}
        title="목록 비우기"
        description="목록의 모든 항목을 삭제할까요?"
        confirmLabel="비우기"
        destructive
        onConfirm={confirmClear}
        onCancel={() => setMode(null)}
      />

      <ConfirmSheet
        open={mode === 'delete'}
        title="목록 삭제"
        description={`'${list.name}' 목록과 모든 항목이 삭제돼요.`}
        confirmLabel="삭제"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setMode(null)}
      />
    </>
  );
}

function OfflineState() {
  return (
    <View className="flex-1 items-center justify-center">
      <Text>오프라인이라 불러올 수 없어요</Text>
    </View>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <View className="flex-1 items-center justify-center gap-4">
      <Text>불러오지 못했어요</Text>
      <Button onPress={onRetry}>
        <Text>다시 시도</Text>
      </Button>
    </View>
  );
}
