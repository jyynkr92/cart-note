import { deleteList, fetchLists, insertList, renameList } from '@/src/lists/list-api';
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

describe('fetchLists', () => {
  it('counts unfinished items and locations, ordered by sort_order then created_at', async () => {
    const calls = mockQuery({
      error: null,
      data: [
        { id: 'l1', name: 'a', items: [{ count: 3 }], list_locations: [{ count: 1 }] },
        { id: 'l2', name: 'b', items: null, list_locations: [] },
      ],
    });
    await expect(fetchLists('f1')).resolves.toEqual([
      { id: 'l1', name: 'a', unfinished_count: 3, has_location: true },
      { id: 'l2', name: 'b', unfinished_count: 0, has_location: false },
    ]);
    expect(from).toHaveBeenCalledWith('lists');
    expect(calls).toEqual([
      ['select', ['*, items(count), list_locations(count)']],
      ['eq', ['family_id', 'f1']],
      ['eq', ['items.is_done', false]],
      ['order', ['sort_order']],
      ['order', ['created_at']],
    ]);
  });

  it('throws on error', async () => {
    mockQuery({ data: null, error: { code: '42501' } });
    await expect(fetchLists('f1')).rejects.toEqual({ code: '42501' });
  });
});

describe('insertList', () => {
  it('inserts with ON CONFLICT DO NOTHING', async () => {
    const calls = mockQuery({ error: null });
    await insertList({ id: 'l1', familyId: 'f1', name: '코스트코', kind: 'store' });
    expect(calls).toEqual([
      [
        'upsert',
        [
          { id: 'l1', family_id: 'f1', name: '코스트코', kind: 'store' },
          { onConflict: 'id', ignoreDuplicates: true },
        ],
      ],
    ]);
  });
});

describe('renameList', () => {
  it('updates only the name', async () => {
    const calls = mockQuery({ error: null });
    await renameList('l1', '이마트');
    expect(calls).toEqual([
      ['update', [{ name: '이마트' }]],
      ['eq', ['id', 'l1']],
    ]);
  });

  it('throws on error', async () => {
    mockQuery({ error: { code: '23514' } });
    await expect(renameList('l1', 'x')).rejects.toEqual({ code: '23514' });
  });
});

describe('deleteList', () => {
  it('deletes by id and rethrows the inbox trigger error', async () => {
    const calls = mockQuery({ error: null });
    await deleteList('l1');
    expect(calls).toEqual([
      ['delete', []],
      ['eq', ['id', 'l1']],
    ]);
    mockQuery({ error: { message: 'inbox list cannot be deleted' } });
    await expect(deleteList('l1')).rejects.toEqual({ message: 'inbox list cannot be deleted' });
  });
});
