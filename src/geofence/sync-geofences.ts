import * as Location from 'expo-location';
import { fetchMyFamilies } from '@/src/groups/group-api';
import { fetchAllMyLocations, type MyLocation } from '@/src/locations/location-api';
import { fetchOpenCounts } from './geofence-api';
import {
  clearUserGeofenceData,
  getEnabled,
  getRegionFingerprint,
  setEnabled,
  setGroupCount,
  setOpenCounts,
  setRegionFingerprint,
  setRegionMeta,
  type RegionMeta,
} from './geofence-store';
import { GEOFENCE_TASK } from './geofence-task';
import { hasBackgroundLocationPermission } from './permissions';
import { selectRegions, type Point } from './select-regions';

export const DEFAULT_RADIUS_M = 300;
export const MAX_REGIONS = 20;
const POSITION_TIMEOUT_MS = 5_000;

export type SyncOptions = { locations?: MyLocation[] };

async function isRegistered(): Promise<boolean> {
  try {
    return await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  } catch {
    return false;
  }
}

async function stopIfRegistered(): Promise<void> {
  if (!(await isRegistered())) return;
  try {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  } catch {
    // 이미 멈췄거나 네이티브 오류: 다음 동기화에서 다시 맞춘다.
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      }
    );
  });
}

/** 마지막으로 알려진 위치 → 없으면 현재 위치(시간 제한). 실패하면 null. */
async function currentPoint(): Promise<Point | null> {
  let pos: Location.LocationObject | null = null;
  try {
    pos = await Location.getLastKnownPositionAsync();
  } catch {
    pos = null;
  }
  if (!pos) {
    pos = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      POSITION_TIMEOUT_MS
    );
  }
  return pos?.coords ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : null;
}

// 로그아웃(resetGeofencing)이 일어나면 진행 중인 동기화가 지역을 다시 등록하지 않도록 세대를 올린다.
let generation = 0;

async function run(opts: SyncOptions): Promise<void> {
  const gen = generation;
  const stale = () => gen !== generation;

  if (!(await getEnabled())) {
    await stopIfRegistered();
    return;
  }
  if (!(await hasBackgroundLocationPermission())) {
    // 설정에서 권한을 철회했다: 조용히 끄고 멈춘다(설정 화면 토글이 꺼진 상태로 보인다).
    await setEnabled(false);
    await stopIfRegistered();
    return;
  }

  let locs: MyLocation[];
  try {
    locs = opts.locations ?? (await fetchAllMyLocations());
  } catch {
    return; // 오프라인 등: 기존 등록을 유지한다.
  }
  try {
    const families = await fetchMyFamilies();
    if (!stale()) await setGroupCount(families.length);
  } catch {
    // 그룹 수는 이전 값을 유지한다.
  }
  if (stale()) return;

  if (locs.length === 0) {
    await setRegionMeta({});
    await stopIfRegistered();
    return;
  }

  const picked = selectRegions(locs, await currentPoint(), MAX_REGIONS);
  const meta: Record<string, RegionMeta> = {};
  for (const l of picked) {
    meta[l.id] = {
      listId: l.list_id,
      familyId: l.family_id,
      groupName: l.family_name,
      placeName: l.place_name,
    };
  }
  let counts: Record<string, number> | null = null;
  try {
    counts = await fetchOpenCounts([...new Set(picked.map((l) => l.list_id))]);
  } catch {
    counts = null; // 이전 스냅샷을 유지한다.
  }
  if (stale()) return;

  const regions = picked.map((l) => ({
    identifier: l.id,
    latitude: l.lat,
    longitude: l.lng,
    radius: l.radius_m ?? DEFAULT_RADIUS_M,
    notifyOnEnter: true,
    notifyOnExit: false,
  }));
  const fingerprint = regions
    .map((r) => `${r.identifier}:${r.latitude}:${r.longitude}:${r.radius}`)
    .sort()
    .join('|');

  // 등록 직후 진입 이벤트가 와도 메타를 찾을 수 있도록 먼저 저장한다.
  await setRegionMeta(meta);
  if (stale()) return;
  if (counts) await setOpenCounts(counts);
  if (stale()) return;

  // 같은 region으로 다시 start하면 iOS가 안에 있는 region마다 Enter를 다시 보낸다 → 바뀌었을 때만 등록한다.
  if (fingerprint === (await getRegionFingerprint()) && (await isRegistered())) return;
  if (stale()) return;
  try {
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
  } catch {
    // 네이티브 오류: 다음 동기화(포그라운드 복귀 등)에서 다시 시도한다.
    return;
  }
  if (stale()) {
    // start 도중 로그아웃했다: 방금 등록한 region을 다시 멈춘다.
    await stopIfRegistered();
    return;
  }
  await setRegionFingerprint(fingerprint);
}

let running: Promise<void> | null = null;
let queued: SyncOptions | null = null;
let trailing: Promise<void> | null = null;

/**
 * 설정/지점/위치에 맞춰 지오펜스를 다시 등록한다. 절대 던지지 않는다.
 * 실행 중에 다시 불리면 겹쳐 실행하지 않고, 끝난 뒤 마지막 요청으로 한 번 더 실행한다.
 */
export function syncGeofences(opts: SyncOptions = {}): Promise<void> {
  if (!running) {
    running = run(opts)
      .catch(() => {})
      .finally(() => {
        running = null;
      });
    return running;
  }
  queued = opts;
  if (!trailing) {
    trailing = running.then(() => {
      const next = queued;
      queued = null;
      trailing = null;
      return next ? syncGeofences(next) : undefined;
    });
  }
  return trailing;
}

/** 로그아웃 시: 지오펜싱을 멈추고 사용자별 지오펜스 데이터를 지운다. 절대 던지지 않는다. */
export async function resetGeofencing(): Promise<void> {
  generation++;
  queued = null;
  try {
    await stopIfRegistered();
    await clearUserGeofenceData();
  } catch {
    // 무시
  }
}
