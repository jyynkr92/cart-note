import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Text } from '@/components/ui/text';
import { useCurrentGroupStore } from './current-group-store';
import type { Family } from './group-api';
import { useGroupNameDialog } from './GroupNameDialog';

export function GroupSwitcher({ family, families }: { family: Family; families: Family[] }) {
  const router = useRouter();
  const { setFamilyId } = useCurrentGroupStore();
  const { open, dialog } = useGroupNameDialog(family);

  if (families.length < 2) {
    return <Text className="text-xl font-bold">{family.name}</Text>;
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

      {dialog}
    </View>
  );
}
