import { createProfile, hasProfile, updateDisplayName } from '@/src/onboarding/profile-api';
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

describe('hasProfile', () => {
  it('looks up the profile row for the user', async () => {
    const calls = mockQuery({ data: { user_id: 'u1' }, error: null });
    await expect(hasProfile('u1')).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('profiles');
    expect(calls).toEqual([
      ['select', ['user_id']],
      ['eq', ['user_id', 'u1']],
      ['maybeSingle', []],
    ]);
  });

  it('is false without a row and throws on error', async () => {
    mockQuery({ data: null, error: null });
    await expect(hasProfile('u1')).resolves.toBe(false);
    mockQuery({ data: null, error: { message: 'TypeError: Network request failed' } });
    await expect(hasProfile('u1')).rejects.toEqual({ message: 'TypeError: Network request failed' });
  });
});

describe('createProfile', () => {
  it('uses a plain insert (column grants forbid a merge upsert)', async () => {
    const calls = mockQuery({ error: null });
    await createProfile('u1', '은정');
    expect(calls).toEqual([['insert', [{ user_id: 'u1', display_name: '은정' }]]]);
  });

  it('throws on error', async () => {
    mockQuery({ error: { code: '23505' } });
    await expect(createProfile('u1', '은정')).rejects.toEqual({ code: '23505' });
  });
});

describe('updateDisplayName', () => {
  it('updates only display_name for the user', async () => {
    const calls = mockQuery({ error: null });
    await updateDisplayName('u1', '새 이름');
    expect(calls).toEqual([
      ['update', [{ display_name: '새 이름' }]],
      ['eq', ['user_id', 'u1']],
    ]);
  });

  it('throws on error', async () => {
    mockQuery({ error: { code: '23514' } });
    await expect(updateDisplayName('u1', 'x')).rejects.toEqual({ code: '23514' });
  });
});
