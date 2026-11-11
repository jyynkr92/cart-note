import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useCurrentGroup } from '@/src/groups/use-groups';
import { ItemEditSheet } from '@/src/items/ItemEditSheet';
import { ItemRow } from '@/src/items/ItemRow';
import type { Item } from '@/src/items/item-api';
import { sortItems } from '@/src/items/sort-items';
import {
  useAddItem,
  useClearDone,
  useClearList,
  useDeleteItems,
  useItems,
  useToggleItem,
  useUpdateItem,
} from '@/src/items/use-items';
import { normalizeName } from '@/src/lib/text';
import { useTopInset } from '@/src/lib/use-top-inset';
import { useDeleteList, useLists, useRenameList } from '@/src/lists/use-lists';

type Mode = 'rename' | 'clear' | 'delete' | null;

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
    if (!familyId) return;
    setDeleting(true);
    deleteList.mutate({ id: listId, familyId });
    setMode(null);
    goHome();
  }

  return wrap(
    <>
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" accessibilityLabel="목록 메뉴">
              <Text>⋯</Text>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem
              disabled={done.length === 0}
              onPress={() => clearDone.mutate({ listId })}>
              <Text>완료 항목 지우기</Text>
            </DropdownMenuItem>
            <DropdownMenuItem onPress={() => setMode('clear')}>
              <Text>목록 비우기</Text>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onPress={openRename}>
              <Text>이름 변경</Text>
            </DropdownMenuItem>
            {list.kind === 'store' ? (
              <DropdownMenuItem
                onPress={() =>
                  router.push({ pathname: '/list/[id]/locations', params: { id: listId } })
                }>
                <Text>지점 관리</Text>
              </DropdownMenuItem>
            ) : null}
            {list.kind !== 'inbox' ? (
              <DropdownMenuItem onPress={() => setMode('delete')}>
                <Text>목록 삭제</Text>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>

      <Input
        placeholder="항목 추가"
        value={text}
        onChangeText={setText}
        onSubmitEditing={submit}
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

      <Dialog open={mode === 'rename'} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>목록 이름 변경</DialogTitle>
          </DialogHeader>
          <Input placeholder="목록 이름" value={listName} onChangeText={setListName} autoFocus />
          <DialogFooter>
            <Button onPress={saveRename} disabled={!renameTrimmed}>
              <Text>저장</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mode === 'clear'} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>목록 비우기</DialogTitle>
            <DialogDescription>목록의 모든 항목을 삭제할까요?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onPress={() => setMode(null)}>
              <Text>취소</Text>
            </Button>
            <Button variant="destructive" onPress={confirmClear}>
              <Text>비우기</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mode === 'delete'} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>목록 삭제</DialogTitle>
            <DialogDescription>{`'${list.name}' 목록과 모든 항목이 삭제돼요.`}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onPress={() => setMode(null)}>
              <Text>취소</Text>
            </Button>
            <Button variant="destructive" onPress={confirmDelete}>
              <Text>삭제</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
