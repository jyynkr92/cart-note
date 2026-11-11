import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Text } from '@/components/ui/text';
import { getEnabled, setEnabled } from './geofence-store';
import { requestNearbyAlertPermissions } from './permissions';
import { syncGeofences } from './sync-geofences';

const LABEL = '근처 마트 알림';

/** 설정 화면의 "근처 마트 알림"(이 기기) 켜기/끄기. 권한이 거부되면 꺼진 채로 시스템 설정 이동을 안내한다. */
export function NearbyAlertToggle() {
  const [on, setOn] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void getEnabled().then((v) => {
      if (alive) setOn(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function change(next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        if ((await requestNearbyAlertPermissions()) !== 'granted') {
          setDenied(true);
          return;
        }
        setDenied(false);
      }
      await setEnabled(next);
      setOn(next);
      await syncGeofences();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="gap-2">
      <Pressable
        className="flex-row items-center gap-3"
        onPress={() => void change(!on)}
        disabled={busy}>
        <Checkbox
          checked={on}
          onCheckedChange={(v) => void change(v)}
          disabled={busy}
          aria-label={LABEL}
          accessibilityLabel={LABEL}
        />
        <View className="flex-1">
          <Text>{LABEL}</Text>
          <Text className="text-sm text-muted-foreground">
            목록에 등록한 마트 근처에 가면 살 것을 알려 줘요(이 기기)
          </Text>
        </View>
      </Pressable>
      {denied ? (
        <View className="flex-row items-center justify-between gap-2">
          <Text className="text-sm text-destructive">위치 권한이 필요해요</Text>
          <Button variant="outline" size="sm" onPress={() => void Linking.openSettings()}>
            <Text>설정 열기</Text>
          </Button>
        </View>
      ) : null}
    </View>
  );
}
