import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 지오펜스 관련 기기 로컬 상태. 백그라운드 작업은 앱 UI 없이(headless) 실행되어 메모리의
 * QueryClient가 복원되지 않으므로, 진입 처리에 필요한 값은 모두 AsyncStorage에 둔다.
 */
const KEYS = {
  enabled: 'geofence:enabled',
  regionMeta: 'geofence:regionMeta',
  lastNotified: 'geofence:lastNotified',
  openCounts: 'geofence:openCounts',
  groupCount: 'geofence:groupCount',
} as const;

export type RegionMeta = { listId: string; familyId: string; groupName: string; placeName: string };

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
}

export async function getEnabled(): Promise<boolean> {
  return (await readJson<boolean>(KEYS.enabled, false)) === true;
}

export async function setEnabled(enabled: boolean): Promise<void> {
  await writeJson(KEYS.enabled, enabled);
}

/** region id(= list_locations.id) → 목록/그룹/지점 정보 */
export function getRegionMeta(): Promise<Record<string, RegionMeta>> {
  return readJson(KEYS.regionMeta, {});
}

export async function setRegionMeta(meta: Record<string, RegionMeta>): Promise<void> {
  await writeJson(KEYS.regionMeta, meta);
}

/** list id → 마지막 알림 시각(ms) */
export function getLastNotified(): Promise<Record<string, number>> {
  return readJson(KEYS.lastNotified, {});
}

export async function markNotified(listId: string, now: number): Promise<void> {
  const last = await getLastNotified();
  await writeJson(KEYS.lastNotified, { ...last, [listId]: now });
}

/** 서버 조회가 실패했을 때 쓰는 목록별 미완료 개수 스냅샷. 없으면 null. */
export async function getCachedOpenCount(listId: string): Promise<number | null> {
  const counts = await readJson<Record<string, number>>(KEYS.openCounts, {});
  const n = counts[listId];
  return typeof n === 'number' ? n : null;
}

export async function setOpenCounts(counts: Record<string, number>): Promise<void> {
  await writeJson(KEYS.openCounts, counts);
}

export async function mergeOpenCounts(counts: Record<string, number>): Promise<void> {
  const prev = await readJson<Record<string, number>>(KEYS.openCounts, {});
  await writeJson(KEYS.openCounts, { ...prev, ...counts });
}

/** 내가 속한 그룹 수. 1개면 알림 문구에서 그룹명을 생략한다. */
export async function getGroupCount(): Promise<number> {
  const n = await readJson<number>(KEYS.groupCount, 1);
  return typeof n === 'number' ? n : 1;
}

export async function setGroupCount(n: number): Promise<void> {
  await writeJson(KEYS.groupCount, n);
}

/** 로그아웃 시: 사용자별 데이터(메타, 개수 스냅샷, 알림 이력, 그룹 수)를 지운다. 켜기/끄기는 기기 설정이라 둔다. */
export async function clearUserGeofenceData(): Promise<void> {
  await AsyncStorage.multiRemove([
    KEYS.regionMeta,
    KEYS.lastNotified,
    KEYS.openCounts,
    KEYS.groupCount,
  ]).catch(() => {});
}
