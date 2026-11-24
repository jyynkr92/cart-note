import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactElement } from 'react';
import { Keyboard } from 'react-native';
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
import { qk } from '@/src/lib/query-keys';
import { MAX_LENGTH, normalizeName } from '@/src/lib/text';
import { toast } from '@/src/lib/toast';
import { useCurrentGroupStore } from './current-group-store';
import { createFamily, type Family } from './group-api';
import { useRenameFamily } from './use-groups';

export type GroupNameMode = 'rename' | 'create';

/**
 * 그룹 이름 변경 / 새 그룹 만들기 시트. 홈의 그룹 전환 메뉴와 설정 화면이 함께 쓴다.
 * 새 그룹을 만들면 그 그룹을 현재 그룹으로 고른다.
 */
export function useGroupNameSheet(family: Family | null): {
  open: (mode: GroupNameMode) => void;
  sheet: ReactElement;
} {
  const qc = useQueryClient();
  const { setFamilyId } = useCurrentGroupStore();
  const rename = useRenameFamily();
  const [mode, setMode] = useState<GroupNameMode | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const trimmed = normalizeName(name);
  // 저장해서 닫는 동안 제목이 '새 그룹'으로 바뀌지 않게 닫기 전 모드를 보인다.
  const shownMode = useLastWhileOpen(mode, mode !== null);

  function open(next: GroupNameMode) {
    setName(next === 'rename' ? (family?.name ?? '') : '');
    setMode(next);
  }

  async function save() {
    if (!trimmed || !mode || inFlight.current) return;
    if (mode === 'rename' && !family) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (mode === 'rename') {
        await rename(family!.id, trimmed);
      } else {
        const id = await createFamily(trimmed);
        await qc.invalidateQueries({ queryKey: qk.families() });
        setFamilyId(id);
      }
      setMode(null);
    } catch {
      // 시트는 열린 채로 남는다. 입력 칸의 키보드가 화면 아래 토스트를 가리지 않게 먼저 내린다.
      Keyboard.dismiss();
      toast.error(mode === 'rename' ? '이름을 바꾸지 못했어요' : '그룹을 만들지 못했어요');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const sheet = (
    <Sheet open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
      <SheetHeader>
        <SheetTitle>{shownMode === 'rename' ? '그룹 이름 변경' : '새 그룹'}</SheetTitle>
      </SheetHeader>
      <SheetInput
        placeholder="그룹 이름"
        value={name}
        onChangeText={setName}
        maxLength={MAX_LENGTH.groupName}
        autoFocus
      />
      <SheetFooter>
        <Button onPress={() => void save()} disabled={!trimmed || busy}>
          <Text>저장</Text>
        </Button>
      </SheetFooter>
    </Sheet>
  );

  return { open, sheet };
}
