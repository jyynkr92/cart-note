import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Text } from '@/components/ui/text';
import { getEnabled, setEnabled } from './geofence-store';
import { hasBackgroundLocationPermission, requestNearbyAlertPermissions } from './permissions';
import { syncGeofences } from './sync-geofences';

const LABEL = '근처 마트 알림';

/** 설정 화면의 "근처 마트 알림"(이 기기) 켜기/끄기. 권한이 거부되면 꺼진 채로 시스템 설정 이동을 안내한다. */
export function NearbyAlertToggle() {
  // null = 저장값을 읽기 전(그 사이 누르면 잘못된 방향으로 바뀌므로 비활성).
  const [on, setOn] = useState<boolean | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const onRef = useRef<boolean | null>(null);
  onRef.current = on;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const wasOn = onRef.current === true;
      const v = await getEnabled();
      if (!alive) return;
      setOn(v);
      // 켜 둔 상태에서 시스템 설정으로 위치 권한을 끄면(동기화가 설정을 꺼도) 거부 안내를 보여 준다.
      if (!v && !wasOn) return;
      const ok = await hasBackgroundLocationPermission();
      if (alive) setDenied(!ok);
    };
    void load();
    // 권한 철회로 동기화가 설정을 끈 경우 등, 포그라운드 복귀 때 설정과 권한을 다시 읽는다.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void load();
    });
    return () => {
      alive = false;
      sub.remove();
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

  const disabled = busy || on === null;
  return (
    <View className="gap-2">
      <Pressable
        className="flex-row items-center gap-3"
        role="checkbox"
        aria-checked={on === true}
        aria-disabled={disabled}
        accessibilityLabel={LABEL}
        accessibilityState={{ checked: on === true, disabled }}
        onPress={() => void change(!on)}
        disabled={disabled}>
        {/* 시각 표시만 한다. 접근성/터치 대상은 바깥 행 하나다. */}
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          <Checkbox checked={on === true} onCheckedChange={() => {}} disabled={disabled} />
        </View>
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
