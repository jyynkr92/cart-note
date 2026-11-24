import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetFooter,
  SheetHeader,
  SheetInput,
  SheetTitle,
  useLastWhileOpen,
} from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { MAX_LENGTH, normalizeName } from '@/src/lib/text';
import type { Item } from './item-api';

type Props = {
  item: Item | null;
  onClose: () => void;
  onSave: (input: { id: string; name: string; note: string | null }) => void;
};

/** 항목 이름/메모 편집. item이 null이면 닫혀 있다. */
export function ItemEditSheet({ item, onClose, onSave }: Props) {
  const open = item !== null;
  // 닫는 동안에는 닫기 전 항목을 그대로 보인다.
  const shown = useLastWhileOpen(item, open);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      {shown ? <EditForm key={shown.id} item={shown} onSave={onSave} /> : null}
    </Sheet>
  );
}

function EditForm({ item, onSave }: { item: Item; onSave: Props['onSave'] }) {
  const [name, setName] = useState(item.name);
  const [note, setNote] = useState(item.note ?? '');
  const trimmed = normalizeName(name);

  return (
    <>
      <SheetHeader>
        <SheetTitle>항목 편집</SheetTitle>
      </SheetHeader>
      <SheetInput
        placeholder="항목 이름"
        value={name}
        onChangeText={setName}
        maxLength={MAX_LENGTH.itemName}
        autoFocus
      />
      <SheetInput
        placeholder="메모"
        value={note}
        onChangeText={setNote}
        maxLength={MAX_LENGTH.itemNote}
      />
      <SheetFooter>
        <Button
          disabled={!trimmed}
          onPress={() =>
            trimmed && onSave({ id: item.id, name: trimmed, note: normalizeName(note) })
          }>
          <Text>저장</Text>
        </Button>
      </SheetFooter>
    </>
  );
}
