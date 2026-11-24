import { Globe, Store } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { List } from './list-api';

/** inbox가 항상 맨 위, 나머지는 sort_order(같으면 생성 순). */
export function sortLists(lists: List[]): List[] {
  return [...lists].sort((a, b) => {
    if ((a.kind === 'inbox') !== (b.kind === 'inbox')) return a.kind === 'inbox' ? -1 : 1;
    return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
  });
}

/** ids에서 from 자리의 id를 빼서 to 자리에 넣은 새 배열(끌어 놓은 뒤의 순서). */
export function moveId(ids: string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

const KIND_MARK = {
  store: { icon: Store, label: '마트' },
  online: { icon: Globe, label: '온라인' },
} as const;

export function ListCard({
  list,
  onPress,
  onLongPress,
}: {
  list: List;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const mark = list.kind === 'inbox' ? null : KIND_MARK[list.kind];
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button">
      <Card className="flex-row items-center justify-between px-4 py-4">
        <View className="flex-1 flex-row items-center gap-2">
          {mark ? (
            <View accessible accessibilityRole="image" accessibilityLabel={mark.label}>
              <Icon as={mark.icon} className="size-4 text-muted-foreground" />
            </View>
          ) : null}
          <Text testID="list-card-name" className="text-base font-semibold">
            {list.name}
          </Text>
          {list.kind === 'store' && list.has_location ? <Text>📍</Text> : null}
        </View>
        <Text className="text-muted-foreground">{list.unfinished_count ?? 0}개 남음</Text>
      </Card>
    </Pressable>
  );
}
