import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { MenuSheet, type MenuSheetItem } from '@/components/ui/sheet';
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

  const items: MenuSheetItem[] = [
    ...families.map((f) => ({
      label: f.name,
      selected: f.id === family.id,
      onPress: () => setFamilyId(f.id),
    })),
    'separator',
    { label: '이름 변경', onPress: () => open('rename') },
    { label: '+ 새 그룹', onPress: () => open('create') },
    { label: '코드로 참여', onPress: () => router.push('/join') },
  ];

  return (
    <View>
      <MenuSheet
        items={items}
        trigger={(show) => (
          <Button variant="ghost" className="self-start px-0" onPress={show}>
            <Text className="text-xl font-bold">{family.name} ▾</Text>
          </Button>
        )}
      />

      {dialog}
    </View>
  );
}
