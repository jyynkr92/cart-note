import { Pressable, View } from 'react-native';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { List } from './list-api';

/** inbox가 항상 맨 위, 나머지는 sort_order(같으면 생성 순). */
export function sortLists(lists: List[]): List[] {
  return [...lists].sort((a, b) => {
    if ((a.kind === 'inbox') !== (b.kind === 'inbox')) return a.kind === 'inbox' ? -1 : 1;
    return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
  });
}

export function ListCard({ list, onPress }: { list: List; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card className="flex-row items-center justify-between px-4 py-4">
        <View className="flex-1 flex-row items-center gap-2">
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
