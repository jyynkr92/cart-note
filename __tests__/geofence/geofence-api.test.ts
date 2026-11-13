import { fetchOpenCount, fetchOpenCounts } from '@/src/geofence/geofence-api';
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

describe('fetchOpenCount', () => {
  it('counts unfinished items of the list with a head request', async () => {
    const calls = mockQuery({ count: 4, error: null });
    await expect(fetchOpenCount('L1')).resolves.toBe(4);
    expect(from).toHaveBeenCalledWith('items');
    expect(calls).toEqual([
      ['select', ['id', { count: 'exact', head: true }]],
      ['eq', ['list_id', 'L1']],
      ['eq', ['is_done', false]],
    ]);
  });

  it('treats a null count as 0 and throws on error', async () => {
    mockQuery({ count: null, error: null });
    await expect(fetchOpenCount('L1')).resolves.toBe(0);
    mockQuery({ count: null, error: { code: 'PGRST301' } });
    await expect(fetchOpenCount('L1')).rejects.toEqual({ code: 'PGRST301' });
  });
});

describe('fetchOpenCounts', () => {
  it('returns {} without querying for no lists', async () => {
    await expect(fetchOpenCounts([])).resolves.toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it('maps each list to its unfinished count (missing embed → 0)', async () => {
    const calls = mockQuery({
      error: null,
      data: [
        { id: 'L1', items: [{ count: 2 }] },
        { id: 'L2', items: null },
      ],
    });
    await expect(fetchOpenCounts(['L1', 'L2'])).resolves.toEqual({ L1: 2, L2: 0 });
    expect(from).toHaveBeenCalledWith('lists');
    expect(calls).toEqual([
      ['select', ['id, items(count)']],
      ['in', ['id', ['L1', 'L2']]],
      ['eq', ['items.is_done', false]],
    ]);
  });

  it('throws on error', async () => {
    mockQuery({ data: null, error: { code: '42501' } });
    await expect(fetchOpenCounts(['L1'])).rejects.toEqual({ code: '42501' });
  });
});
