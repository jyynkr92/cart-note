import { deleteItems, fetchItems, insertItem, moveItems, updateItem } from '@/src/items/item-api';
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
