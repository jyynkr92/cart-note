import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Text } from '@/components/ui/text';
import type { List } from '@/src/lists/list-api';

type Props = {
  open: boolean;
  /** 이동할 수 있는 목록(현재 목록 제외). */
  lists: List[];
  onClose: () => void;
  onSelect: (listId: string) => void;
};

/** 선택한 항목을 옮길 목록을 고르는 시트. ItemEditSheet와 같은 Dialog 패턴을 쓴다. */
export function MoveSheet({ open, lists, onClose, onSelect }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>다른 목록으로 이동</DialogTitle>
          {lists.length === 0 ? (
            <DialogDescription>이동할 수 있는 목록이 없어요</DialogDescription>
          ) : null}
        </DialogHeader>
        {lists.map((l) => (
          <Button key={l.id} variant="outline" onPress={() => onSelect(l.id)}>
            <Text>{l.name}</Text>
          </Button>
        ))}
      </DialogContent>
    </Dialog>
  );
}
