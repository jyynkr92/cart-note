import { useState } from 'react';
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
import { normalizeName } from '@/src/lib/text';
import type { Item } from './item-api';

type Props = {
  item: Item | null;
  onClose: () => void;
  onSave: (input: { id: string; name: string; note: string | null }) => void;
};

/** 항목 이름/메모 편집. item이 null이면 닫혀 있다. */
export function ItemEditSheet({ item, onClose, onSave }: Props) {
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      {item ? <EditForm key={item.id} item={item} onSave={onSave} /> : null}
    </Dialog>
  );
}

function EditForm({ item, onSave }: { item: Item; onSave: Props['onSave'] }) {
  const [name, setName] = useState(item.name);
  const [note, setNote] = useState(item.note ?? '');
  const trimmed = normalizeName(name);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>항목 편집</DialogTitle>
      </DialogHeader>
      <Input placeholder="항목 이름" value={name} onChangeText={setName} autoFocus />
      <Input placeholder="메모" value={note} onChangeText={setNote} />
      <DialogFooter>
        <Button
          disabled={!trimmed}
          onPress={() =>
            trimmed && onSave({ id: item.id, name: trimmed, note: normalizeName(note) })
          }>
          <Text>저장</Text>
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
