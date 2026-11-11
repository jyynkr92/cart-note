import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import type { Family } from './group-api';

export const CURRENT_GROUP_KEY = 'cart-note-current-group';

type State = { familyId: string | null; ready: boolean };

let state: State = { familyId: null, ready: false };
let hydrating: Promise<void> | null = null;
let version = 0; // reset/선택이 있으면 늦게 도착한 hydrate 결과를 버린다
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  for (const l of listeners) l();
}

function hydrate(): Promise<void> {
  if (state.ready) return Promise.resolve();
  if (!hydrating) {
    const v = version;
    hydrating = AsyncStorage.getItem(CURRENT_GROUP_KEY)
      .catch(() => null)
      .then((saved) => {
        if (v !== version) return;
        set({ familyId: saved || null, ready: true });
      })
      .finally(() => {
        hydrating = null;
      });
  }
  return hydrating;
}

function setFamilyId(id: string) {
  version++;
  set({ familyId: id, ready: true });
  AsyncStorage.setItem(CURRENT_GROUP_KEY, id).catch(() => {});
}

/** 테스트용: 메모리 상태만 초기화한다. */
export function resetCurrentGroupStore() {
  version++;
  hydrating = null;
  state = { familyId: null, ready: false };
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  void hydrate();
  return () => void listeners.delete(l);
}

const getSnapshot = () => state;

/** 마지막으로 선택한 그룹 id(기기 로컬 저장). `ready`는 저장값을 읽은 뒤 true. */
export function useCurrentGroupStore(): State & { setFamilyId(id: string): void } {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...s, setFamilyId };
}

/** 저장된 id가 목록에 있으면 그대로, 없으면 가장 오래된 그룹, 그룹이 없으면 null. */
export function resolveCurrentFamily(saved: string | null, families: Family[]): string | null {
  if (saved && families.some((f) => f.id === saved)) return saved;
  const first = [...families].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  return first?.id ?? null;
}
