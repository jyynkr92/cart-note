/**
 * 큐 mutation 재생의 계약.
 *
 * 오프라인 큐의 mutation은 나중에(앱을 다시 켠 뒤, 다른 사람이 데이터를 바꾼 뒤) 재생된다.
 * 그래서 서버에 보내는 요청은 영속화된 변수만으로 정해져야 한다.
 *   1) 재생 시점의 캐시가 달라도(비었거나 남이 넣은 항목이 있어도) 요청이 똑같다. 대상(id, 원래 목록 등)은
 *      누를 때 prepare에서 변수에 담고, mutationFn에서 캐시를 읽어 다시 고르지 않는다.
 *   2) update/delete는 항상 변수에 담긴 행 id(`eq('id')` 또는 `in('id')`)로 범위를 좁힌다.
 *      `eq('list_id', …)` 같은 집합 조건만으로 지우면 재생 때 그 사이 남이 넣은 행까지 지운다.
 * 새 mk 키를 추가하고 SAMPLE에 변수를 넣지 않으면 이 테스트가 실패한다.
 * 이 테스트가 잡지 못하는 것(서버 문장이 누를 때의 조건을 다시 확인하는지)은 아래 learning을 본다.
 * 배경: docs/solutions/logic-errors/offline-queue-replay-must-carry-targets-and-reassert-intent.md
 */
import { QueryClient } from '@tanstack/react-query';
import { registerItemMutations } from '@/src/items/use-items';
import type { Item } from '@/src/items/item-api';
import { registerListMutations } from '@/src/lists/use-lists';
import { registerLocationMutations } from '@/src/locations/use-locations';
import { mk, qk } from '@/src/lib/query-keys';
import {
  installSessionCheck,
  openSession,
  resetSessionGateForTests,
} from '@/src/lib/session-gate';
import { supabase } from '@/src/lib/supabase';
import { chain } from '@/test-utils/supabase-chain';

jest.mock('@/src/lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock('@/src/lib/toast', () => ({ toast: { error: jest.fn() } }));

type Call = [string, unknown[]];
const from = supabase.from as jest.Mock;
const rpc = supabase.rpc as jest.Mock;
let requests: { table: string; calls: Call[] }[] = [];

const T = '2026-01-01T00:00:00.000Z';
const item = (id: string, listId: string, isDone = false): Item => ({
  id,
  list_id: listId,
  family_id: 'f1',
  name: id,
  note: null,
  is_done: isDone,
  done_at: isDone ? T : null,
  sort_order: 0,
  created_at: T,
  updated_at: T,
  created_by: null,
});

/** 키 이름 → 누를 때 prepare가 만든 것과 같은 모양의 영속화된 변수. */
const SAMPLE: Record<Exclude<keyof typeof mk, 'all'>, unknown> = {
  addItem: { id: 'i9', listId: 'l1', familyId: 'f1', name: '우유', createdAt: T },
  toggleItem: { item: item('a', 'l1'), isDone: true, doneAt: T },
  updateItem: { id: 'a', name: '두유' },
  deleteItems: { listId: 'l1', ids: ['a'] },
  clearDone: { listId: 'l1', ids: ['a'] },
  clearList: { listId: 'l1', ids: ['a', 'b'] },
  moveItems: { fromListId: 'l1', toListId: 'l2', ids: ['a'] },
  createList: { id: 'l9', familyId: 'f1', name: '마트', kind: 'store', createdAt: T, sortOrder: 3 },
  renameList: { id: 'l1', familyId: 'f1', name: '새 이름' },
  deleteList: { id: 'l2', familyId: 'f1' },
  reorderLists: { familyId: 'f1', ids: ['l2', 'l1'] },
  addLocation: {
    id: 'p9',
    listId: 'l1',
    familyId: 'f1',
    place: { kakao_place_id: 'k9', place_name: '마트', address: '서울', lat: 37.5, lng: 127 },
    radiusM: 300,
  },
  deleteLocation: { id: 'p1', listId: 'l1', familyId: 'f1' },
};

const KEYS = (Object.keys(mk) as (keyof typeof mk)[]).filter((k) => k !== 'all') as Exclude<
  keyof typeof mk,
  'all'
>[];

function client(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  registerItemMutations(qc);
  registerListMutations(qc);
  registerLocationMutations(qc);
  return qc;
}

/** 재생 시점의 캐시: 누른 뒤 다른 사람이 넣은 항목(c, e), 완료로 바뀐 항목 등이 섞여 있다. */
function seedLaterState(qc: QueryClient) {
  qc.setQueryData(qk.items('l1'), [item('a', 'l1', true), item('b', 'l1'), item('c', 'l1', true)]);
  qc.setQueryData(qk.items('l2'), [item('d', 'l2'), item('e', 'l2', true)]);
  qc.setQueryData(qk.lists('f1'), [
    { id: 'l1', family_id: 'f1', name: 'l1', kind: 'store', sort_order: 0, created_at: T },
    { id: 'l2', family_id: 'f1', name: 'l2', kind: 'store', sort_order: 0, created_at: T },
  ]);
  qc.setQueryData(qk.locations('l1'), [{ id: 'p1', list_id: 'l1' }, { id: 'p2', list_id: 'l1' }]);
}

/** 큐가 재생할 때와 같이 등록된 mutationFn을 변수만으로 실행하고, 나간 요청을 기록한다. */
async function replay(qc: QueryClient, key: keyof typeof SAMPLE) {
  requests = [];
  const fn = qc.getMutationDefaults(mk[key]).mutationFn as (v: unknown) => Promise<unknown>;
  expect(fn).toBeDefined();
  await fn(structuredClone(SAMPLE[key]));
  return requests;
}

beforeEach(() => {
  jest.clearAllMocks();
  from.mockImplementation((table: string) => {
    const c = chain({ data: null, error: null });
    requests.push({ table, calls: c.calls });
    return c.builder;
  });
  // RPC는 서버가 대상(그룹·id)을 직접 확인하므로 요청 자체만 기록한다.
  rpc.mockImplementation(async (fn: string, args: unknown) => {
    requests.push({ table: `rpc:${fn}`, calls: [['rpc', [fn, args]]] });
    return { data: null, error: null };
  });
  installSessionCheck(async () => 'u1');
  openSession('u1');
});
afterEach(() => resetSessionGateForTests());

it('has persisted sample variables for every queue mutation key', () => {
  expect(KEYS.filter((k) => !(k in SAMPLE))).toEqual([]);
});

describe.each(KEYS)('queue mutation %s', (key) => {
  it('sends the same requests whatever the cache holds at replay time', async () => {
    const fresh = await replay(client(), key);
    const qc = client();
    seedLaterState(qc);
    const later = await replay(qc, key);
    expect(fresh.length).toBeGreaterThan(0);
    expect(later).toEqual(fresh);
  });

  it('scopes every update/delete to row ids carried in the variables', async () => {
    const sent = await replay(client(), key);
    for (const { table, calls } of sent) {
      const writes = calls.some(([m]) => m === 'update' || m === 'delete');
      if (!writes) continue;
      const byId = calls.some(([m, args]) => (m === 'eq' || m === 'in') && args[0] === 'id');
      if (!byId) {
        throw new Error(
          `${key}: ${table} update/delete is not scoped by row id (${JSON.stringify(calls)}). ` +
            'Capture the target ids in the persisted variables and filter with .in("id", ids).'
        );
      }
    }
  });
});
