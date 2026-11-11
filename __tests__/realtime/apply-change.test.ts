import { QueryClient } from '@tanstack/react-query';
import type { Item } from '@/src/items/item-api';
import { qk } from '@/src/lib/query-keys';
import { applyChange } from '@/src/realtime/apply-change';

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  list_id: 'l1',
  family_id: 'f1',
  name: id,
  note: null,
  is_done: false,
  done_at: null,
  sort_order: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  created_by: null,
  ...over,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const change = (eventType: 'INSERT' | 'UPDATE' | 'DELETE', n: any, o: any = {}): any => ({
  eventType,
  new: n,
  old: o,
  schema: 'public',
});

let qc: QueryClient;
let spy: jest.SpyInstance;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  spy = jest.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
});
afterEach(() => {
  qc.clear();
});

const keys = () => spy.mock.calls.map((c) => c[0].queryKey);

describe('items', () => {
  it('INSERT adds to the list cache without duplicating the same id', () => {
    qc.setQueryData(qk.items('l1'), [item('a')]);
    applyChange(qc, 'items', change('INSERT', item('b')));
    applyChange(qc, 'items', change('INSERT', item('b')));
    expect(qc.getQueryData<Item[]>(qk.items('l1'))!.map((i) => i.id)).toEqual(['a', 'b']);
    expect(keys()).toContainEqual(qk.lists('f1'));
  });

  it('INSERT is a no-op for a list that is not cached', () => {
    applyChange(qc, 'items', change('INSERT', item('b')));
    expect(qc.getQueryData(qk.items('l1'))).toBeUndefined();
  });

  it('UPDATE replaces the cached item', () => {
    qc.setQueryData(qk.items('l1'), [item('a')]);
    applyChange(
      qc,
      'items',
      change('UPDATE', item('a', { is_done: true, updated_at: '2026-01-02T00:00:00.000Z' }))
    );
    expect(qc.getQueryData<Item[]>(qk.items('l1'))![0].is_done).toBe(true);
  });

  it('UPDATE with a changed list_id removes from the old list and adds to the new one', () => {
    qc.setQueryData(qk.items('l1'), [item('a')]);
    qc.setQueryData(qk.items('l2'), []);
    applyChange(
      qc,
      'items',
      change('UPDATE', item('a', { list_id: 'l2', updated_at: '2026-01-02T00:00:00.000Z' }))
    );
    expect(qc.getQueryData<Item[]>(qk.items('l1'))).toEqual([]);
    expect(qc.getQueryData<Item[]>(qk.items('l2'))!.map((i) => i.id)).toEqual(['a']);
  });

  it('UPDATE older than the cached updated_at is ignored', () => {
    qc.setQueryData(qk.items('l1'), [
      item('a', { name: 'new', updated_at: '2026-01-05T00:00:00.000Z' }),
    ]);
    applyChange(
      qc,
      'items',
      change('UPDATE', item('a', { name: 'stale', updated_at: '2026-01-02T00:00:00.000Z' }))
    );
    expect(qc.getQueryData<Item[]>(qk.items('l1'))![0].name).toBe('new');
  });

  it('a cached item without updated_at loses to the server echo', () => {
    const optimistic = { ...item('a', { name: 'opt' }), updated_at: undefined } as unknown as Item;
    qc.setQueryData(qk.items('l1'), [optimistic]);
    applyChange(qc, 'items', change('UPDATE', item('a', { name: 'server' })));
    expect(qc.getQueryData<Item[]>(qk.items('l1'))![0].name).toBe('server');
  });

  it('DELETE never edits the cache, only invalidates prefixes', () => {
    qc.setQueryData(qk.items('l1'), [item('a')]);
    applyChange(qc, 'items', change('DELETE', null, { id: 'a' }));
    expect(qc.getQueryData<Item[]>(qk.items('l1'))!.map((i) => i.id)).toEqual(['a']);
    expect(keys()).toEqual(expect.arrayContaining([['items'], ['lists']]));
  });
});

describe('items while a mutation is pending', () => {
  beforeEach(() => {
    jest.spyOn(qc, 'isMutating').mockReturnValue(1);
  });

  it('UPDATE leaves the optimistic cache alone and skips invalidation', () => {
    qc.setQueryData(qk.items('l1'), [item('a', { is_done: true })]);
    applyChange(
      qc,
      'items',
      change('UPDATE', item('a', { is_done: false, updated_at: '2026-02-01T00:00:00.000Z' }))
    );
    expect(qc.getQueryData<Item[]>(qk.items('l1'))![0].is_done).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('INSERT is skipped', () => {
    qc.setQueryData(qk.items('l1'), [item('a')]);
    applyChange(qc, 'items', change('INSERT', item('b')));
    expect(qc.getQueryData<Item[]>(qk.items('l1'))).toHaveLength(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('DELETE and lists events do not invalidate items/lists', () => {
    applyChange(qc, 'items', change('DELETE', null, { id: 'a' }));
    applyChange(qc, 'lists', change('UPDATE', { id: 'l1', family_id: 'f1' }));
    applyChange(qc, 'lists', change('DELETE', null, { id: 'l1' }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('list_locations only invalidates allLocations (the rest waits for the idle sweep)', () => {
    applyChange(
      qc,
      'list_locations',
      change('INSERT', { id: 'x', list_id: 'l1', family_id: 'f1' })
    );
    expect(keys()).toEqual([qk.allLocations()]);
  });
});

describe('ordering', () => {
  it('inserts into created_at order', () => {
    qc.setQueryData(qk.items('l1'), [
      item('a', { created_at: '2026-01-01T00:00:00.000Z' }),
      item('c', { created_at: '2026-01-03T00:00:00.000Z' }),
    ]);
    applyChange(
      qc,
      'items',
      change('INSERT', item('b', { created_at: '2026-01-02T00:00:00.000Z' }))
    );
    expect(qc.getQueryData<Item[]>(qk.items('l1'))!.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('lists', () => {
  it('INSERT/UPDATE invalidate qk.lists(family_id)', () => {
    applyChange(qc, 'lists', change('UPDATE', { id: 'l1', family_id: 'f1' }));
    expect(keys()).toEqual([qk.lists('f1')]);
  });

  it('DELETE invalidates the lists prefix only', () => {
    qc.setQueryData(qk.lists('f1'), [{ id: 'l1' }]);
    applyChange(qc, 'lists', change('DELETE', null, { id: 'l1' }));
    expect(keys()).toEqual([['lists']]);
    expect(qc.getQueryData(qk.lists('f1'))).toEqual([{ id: 'l1' }]);
  });
});

describe('list_locations', () => {
  it('INSERT/UPDATE invalidate locations(list_id), allLocations and the lists', () => {
    applyChange(
      qc,
      'list_locations',
      change('INSERT', { id: 'x', list_id: 'l1', family_id: 'f1' })
    );
    expect(keys()).toEqual(
      expect.arrayContaining([qk.locations('l1'), qk.allLocations(), qk.lists('f1')])
    );
  });

  it('DELETE invalidates the prefixes', () => {
    applyChange(qc, 'list_locations', change('DELETE', null, { id: 'x' }));
    expect(keys()).toEqual(expect.arrayContaining([['locations'], qk.allLocations(), ['lists']]));
  });
});

describe('list_locations while mutations are busy', () => {
  const busy = () => {
    // 진행 중인 mutation 하나를 흉내 낸다.
    jest.spyOn(qc, 'isMutating').mockReturnValue(1);
  };

  it('INSERT/UPDATE skip locations(list_id) and lists, but still invalidate allLocations', () => {
    busy();
    applyChange(qc, 'list_locations', change('INSERT', { id: 'x', list_id: 'l1', family_id: 'f1' }));
    expect(keys()).toEqual([qk.allLocations()]);
  });

  it('DELETE skips the locations/lists prefixes, but still invalidates allLocations', () => {
    busy();
    applyChange(qc, 'list_locations', change('DELETE', null, { id: 'x' }));
    expect(keys()).toEqual([qk.allLocations()]);
  });
});
