import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactElement } from 'react';
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
import { qk } from '@/src/lib/query-keys';
import { normalizeName } from '@/src/lib/text';
import { toast } from '@/src/lib/toast';
import { useCurrentGroupStore } from './current-group-store';
import { createFamily, type Family } from './group-api';
import { useRenameFamily } from './use-groups';

export type GroupNameMode = 'rename' | 'create';

/**
 * 그룹 이름 변경 / 새 그룹 만들기 대화상자. 홈의 그룹 전환 메뉴와 설정 화면이 함께 쓴다.
 * 새 그룹을 만들면 그 그룹을 현재 그룹으로 고른다.
 */
export function useGroupNameDialog(family: Family | null): {
  open: (mode: GroupNameMode) => void;
  dialog: ReactElement;
} {
  const qc = useQueryClient();
  const { setFamilyId } = useCurrentGroupStore();
  const rename = useRenameFamily();
  const [mode, setMode] = useState<GroupNameMode | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const trimmed = normalizeName(name);

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
      toast.error(mode === 'rename' ? '이름을 바꾸지 못했어요' : '그룹을 만들지 못했어요');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const dialog = (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'rename' ? '그룹 이름 변경' : '새 그룹'}</DialogTitle>
        </DialogHeader>
        <Input placeholder="그룹 이름" value={name} onChangeText={setName} autoFocus />
        <DialogFooter>
          <Button onPress={() => void save()} disabled={!trimmed || busy}>
            <Text>저장</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { open, dialog };
}
