import {
  clearDoneItems,
  clearListItems,
  deleteItems,
  fetchItems,
  insertItem,
  moveItems,
  updateItem,
} from '@/src/items/item-api';
import { supabase } from '@/src/lib/supabase';
import { chain } from '@/test-utils/supabase-chain';

jest.mock('@/src/lib/supabase', () => ({ supabase: { from: jest.fn() } }));
const from = supabase.from as jest.Mock;

function mockQuery(result: unknown) {
  const c = chain(result);
  from.mockReturnValue(c.builder);
  return c.calls;
}

beforeEach(() => jest.clearAllMocks());

describe('fetchItems', () => {
  it('selects the list items in creation order', async () => {
    const calls = mockQuery({ data: [{ id: 'a' }], error: null });
    await expect(fetchItems('l1')).resolves.toEqual([{ id: 'a' }]);
    expect(from).toHaveBeenCalledWith('items');
    expect(calls).toEqual([
      ['select', ['*']],
      ['eq', ['list_id', 'l1']],
      ['order', ['created_at']],
    ]);
  });

  it('returns [] for null data and throws on error', async () => {
    mockQuery({ data: null, error: null });
    await expect(fetchItems('l1')).resolves.toEqual([]);
    mockQuery({ data: null, error: { code: '42501' } });
    await expect(fetchItems('l1')).rejects.toEqual({ code: '42501' });
  });
});

describe('insertItem', () => {
  it('inserts with ON CONFLICT DO NOTHING (never a merge upsert)', async () => {
    const calls = mockQuery({ error: null });
    await insertItem({ id: 'i1', listId: 'l1', familyId: 'f1', name: '우유' });
    expect(calls).toEqual([
      [
        'upsert',
        [
          { id: 'i1', list_id: 'l1', family_id: 'f1', name: '우유' },
          { onConflict: 'id', ignoreDuplicates: true },
        ],
      ],
    ]);
  });

  it('throws on error', async () => {
    mockQuery({ error: { code: '23503' } });
    await expect(insertItem({ id: 'i1', listId: 'l1', familyId: 'f1', name: 'x' })).rejects.toEqual({
      code: '23503',
    });
  });
});

describe('updateItem', () => {
  it('sends only the given patch for the id', async () => {
    const calls = mockQuery({ error: null });
    await updateItem('i1', { is_done: true, done_at: '2026-01-01T00:00:00.000Z' });
    expect(calls).toEqual([
      ['update', [{ is_done: true, done_at: '2026-01-01T00:00:00.000Z' }]],
      ['eq', ['id', 'i1']],
    ]);
  });

  it('throws on error', async () => {
    mockQuery({ error: { code: '42501' } });
    await expect(updateItem('i1', { name: 'x' })).rejects.toEqual({ code: '42501' });
  });
});

describe('deleteItems', () => {
  it('deletes exactly the given ids', async () => {
    const calls = mockQuery({ error: null });
    await deleteItems(['a', 'b']);
    expect(calls).toEqual([
      ['delete', []],
      ['in', ['id', ['a', 'b']]],
    ]);
  });

  it('is a no-op for an empty id list', async () => {
    await deleteItems([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('throws on error', async () => {
    mockQuery({ error: { code: '42501' } });
    await expect(deleteItems(['a'])).rejects.toEqual({ code: '42501' });
  });
});

describe('moveItems', () => {
  it('updates only list_id for the ids', async () => {
    const calls = mockQuery({ error: null });
    await moveItems('l2', ['a']);
    expect(calls).toEqual([
      ['update', [{ list_id: 'l2' }]],
      ['in', ['id', ['a']]],
    ]);
  });

  it('is a no-op for an empty id list', async () => {
    await moveItems('l2', []);
    expect(from).not.toHaveBeenCalled();
  });
});

// B2: 재실행 때 id만으로 지우면, 그 사이 다른 목록으로 옮겨졌거나 다시 미완료가 된 항목까지 지운다.
describe('clear guards (B2)', () => {
  it('clearDoneItems deletes only the ids that are still done in that list', async () => {
    const calls = mockQuery({ error: null });
    await clearDoneItems('l1', ['a', 'b']);
    expect(from).toHaveBeenCalledWith('items');
    expect(calls).toEqual([
      ['delete', []],
      ['in', ['id', ['a', 'b']]],
      ['eq', ['list_id', 'l1']],
      ['eq', ['is_done', true]],
    ]);
  });

  it('clearListItems deletes only the ids still in that list', async () => {
    const calls = mockQuery({ error: null });
    await clearListItems('l1', ['a']);
    expect(calls).toEqual([
      ['delete', []],
      ['in', ['id', ['a']]],
      ['eq', ['list_id', 'l1']],
    ]);
  });

  it('are no-ops for empty ids and rethrow errors', async () => {
    await clearDoneItems('l1', []);
    await clearListItems('l1', []);
    expect(from).not.toHaveBeenCalled();
    mockQuery({ error: { code: '42501' } });
    await expect(clearListItems('l1', ['a'])).rejects.toEqual({ code: '42501' });
  });
});

// B3: 긴 id 목록은 URL 길이 제한에 걸리므로 100개씩 순서대로 보낸다.
describe('batching (B3)', () => {
  const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);

  function recordBatches() {
    const batches: unknown[][] = [];
    from.mockImplementation(() => {
      const c = chain({ error: null });
      const calls = c.calls;
      queueMicrotask(() => {
        const inCall = calls.find(([m]) => m === 'in');
        if (inCall) batches.push(inCall[1][1] as unknown[]);
      });
      return c.builder;
    });
    return batches;
  }

  it.each([
    ['deleteItems', () => deleteItems(ids)],
    ['moveItems', () => moveItems('l2', ids)],
    ['clearDoneItems', () => clearDoneItems('l1', ids)],
    ['clearListItems', () => clearListItems('l1', ids)],
  ])('%s sends ids in batches of 100', async (_name, run) => {
    const batches = recordBatches();
    await run();
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toEqual(ids);
  });

  it('sends batches one after another and stops at the first error', async () => {
    let release!: (v: unknown) => void;
    const first = chain(new Promise((r) => (release = r)));
    const second = chain({ error: { code: '42501' } });
    from.mockReturnValueOnce(first.builder).mockReturnValueOnce(second.builder);
    const p = deleteItems(ids);
    await Promise.resolve();
    expect(from).toHaveBeenCalledTimes(1);
    release({ error: null });
    await expect(p).rejects.toEqual({ code: '42501' });
    expect(from).toHaveBeenCalledTimes(2);
  });
});
