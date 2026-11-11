import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { qk } from '@/src/lib/query-keys';
import { normalizeName } from '@/src/lib/text';
import { toast } from '@/src/lib/toast';
import { useCurrentGroupStore } from './current-group-store';
import { createFamily, type Family } from './group-api';
import { useRenameFamily } from './use-groups';

type Mode = 'rename' | 'create' | null;

export function GroupSwitcher({ family, families }: { family: Family; families: Family[] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { setFamilyId } = useCurrentGroupStore();
  const rename = useRenameFamily();
  const [mode, setMode] = useState<Mode>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  if (families.length < 2) {
    return <Text className="text-xl font-bold">{family.name}</Text>;
  }

  const trimmed = normalizeName(name);

  function open(next: Exclude<Mode, null>) {
    setName(next === 'rename' ? family.name : '');
    setMode(next);
  }

  async function save() {
    if (!trimmed || busy || !mode) return;
    setBusy(true);
    try {
      if (mode === 'rename') {
        await rename(family.id, trimmed);
      } else {
        const id = await createFamily(trimmed);
        await qc.invalidateQueries({ queryKey: qk.families() });
        setFamilyId(id);
      }
      setMode(null);
    } catch {
      toast.error(mode === 'rename' ? '이름을 바꾸지 못했어요' : '그룹을 만들지 못했어요');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="self-start px-0">
            <Text className="text-xl font-bold">{family.name} ▾</Text>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          {families.map((f) => (
            <DropdownMenuItem key={f.id} onPress={() => setFamilyId(f.id)}>
              <Text className={f.id === family.id ? 'font-bold' : undefined}>{f.name}</Text>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onPress={() => open('rename')}>
            <Text>이름 변경</Text>
          </DropdownMenuItem>
          <DropdownMenuItem onPress={() => open('create')}>
            <Text>+ 새 그룹</Text>
          </DropdownMenuItem>
          <DropdownMenuItem onPress={() => router.push('/join')}>
            <Text>코드로 참여</Text>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === 'rename' ? '그룹 이름 변경' : '새 그룹'}</DialogTitle>
          </DialogHeader>
          <Input placeholder="그룹 이름" value={name} onChangeText={setName} autoFocus />
          <DialogFooter>
            <Button onPress={save} disabled={!trimmed || busy}>
              <Text>저장</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </View>
  );
}
