import { Pencil } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import type { Item } from './item-api';

type Props = {
  item: Item;
  onToggle: (item: Item) => void;
  onEdit: (item: Item) => void;
  onDelete: (item: Item) => void;
  /** 선택 모드 여부. 켜져 있으면 탭은 선택 토글이고 연필(편집)은 숨고 체크박스/스와이프 삭제는 꺼진다. */
  selecting?: boolean;
  selected?: boolean;
  onLongPress?: (item: Item) => void;
  onSelectToggle?: (item: Item) => void;
};

/** 항목 한 줄. 왼쪽 스와이프로 삭제 액션이 드러나고, 길게 누르면 선택 모드가 시작된다. */
export function ItemRow({
  item,
  onToggle,
  onEdit,
  onDelete,
  selecting = false,
  selected = false,
  onLongPress,
  onSelectToggle,
}: Props) {
  return (
    <ReanimatedSwipeable
      enabled={!selecting}
      overshootRight={false}
      renderRightActions={
        selecting
          ? undefined
          : () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="삭제"
                onPress={() => onDelete(item)}
                className="w-20 items-center justify-center bg-destructive">
                <Text className="text-sm font-medium text-white">삭제</Text>
              </Pressable>
            )
      }>
      <View
        className={cn(
          'flex-row items-center gap-3 px-4 py-3',
          selected ? 'bg-accent' : 'bg-background'
        )}>
        <Checkbox
          checked={item.is_done}
          disabled={selecting}
          onCheckedChange={() => onToggle(item)}
          aria-label={`${item.name} 완료`}
        />
        <Pressable
          className="flex-1"
          onPress={() => (selecting ? onSelectToggle?.(item) : onToggle(item))}
          onLongPress={() => onLongPress?.(item)}
          accessibilityRole="button"
          accessibilityState={{ selected }}>
          <Text
            testID="item-name"
            className={cn('text-base', item.is_done && 'text-muted-foreground line-through')}>
            {item.name}
          </Text>
          {item.note ? <Text className="text-sm text-muted-foreground">{item.note}</Text> : null}
        </Pressable>
        {selecting ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="편집"
            hitSlop={4}
            onPress={() => onEdit(item)}
            className="size-11 items-center justify-center">
            <Icon as={Pencil} className="size-5 text-muted-foreground" />
          </Pressable>
        )}
      </View>
    </ReanimatedSwipeable>
  );
}
