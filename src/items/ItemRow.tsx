import { Pressable, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Checkbox } from '@/components/ui/checkbox';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import type { Item } from './item-api';

type Props = {
  item: Item;
  onToggle: (item: Item) => void;
  onPress: (item: Item) => void;
  onDelete: (item: Item) => void;
};

/** 항목 한 줄. 왼쪽 스와이프로 삭제 액션이 드러난다. (선택 모드는 이후 태스크에서 이 컴포넌트를 확장한다.) */
export function ItemRow({ item, onToggle, onPress, onDelete }: Props) {
  return (
    <ReanimatedSwipeable
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="삭제"
          onPress={() => onDelete(item)}
          className="w-20 items-center justify-center bg-destructive">
          <Text className="text-sm font-medium text-white">삭제</Text>
        </Pressable>
      )}>
      <View className="flex-row items-center gap-3 bg-background px-4 py-3">
        <Checkbox
          checked={item.is_done}
          onCheckedChange={() => onToggle(item)}
          aria-label={`${item.name} 완료`}
        />
        <Pressable className="flex-1" onPress={() => onPress(item)} accessibilityRole="button">
          <Text
            testID="item-name"
            className={cn('text-base', item.is_done && 'text-muted-foreground line-through')}>
            {item.name}
          </Text>
          {item.note ? <Text className="text-sm text-muted-foreground">{item.note}</Text> : null}
        </Pressable>
      </View>
    </ReanimatedSwipeable>
  );
}
