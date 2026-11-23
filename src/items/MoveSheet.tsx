import { Button } from '@/components/ui/button';
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import type { List } from '@/src/lists/list-api';

type Props = {
  open: boolean;
  /** 이동할 수 있는 목록(현재 목록 제외). */
  lists: List[];
  onClose: () => void;
  onSelect: (listId: string) => void;
};

/** 선택한 항목을 옮길 목록을 고르는 시트. */
export function MoveSheet({ open, lists, onClose, onSelect }: Props) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetHeader>
        <SheetTitle>다른 목록으로 이동</SheetTitle>
        {lists.length === 0 ? (
          <SheetDescription>이동할 수 있는 목록이 없어요</SheetDescription>
        ) : null}
      </SheetHeader>
      {lists.map((l) => (
        <Button key={l.id} variant="outline" className="w-full" onPress={() => onSelect(l.id)}>
          <Text>{l.name}</Text>
        </Button>
      ))}
    </Sheet>
  );
}
