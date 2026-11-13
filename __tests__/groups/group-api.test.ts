import * as api from '@/src/groups/group-api';
import { GroupError, joinFamily } from '@/src/groups/group-api';
import { supabase } from '@/src/lib/supabase';
import { chain } from '@/test-utils/supabase-chain';

jest.mock('@/src/lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
const rpc = supabase.rpc as unknown as jest.Mock;

const codeOf = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as { code: string }).code;

it('returns the family id on success', async () => {
  rpc.mockResolvedValue({ data: { family_id: 'f1' }, error: null });
  await expect(joinFamily('123456')).resolves.toBe('f1');
  expect(rpc).toHaveBeenCalledWith('join_family', { p_code: '123456' });
});

it('maps the returned invalid_code error', async () => {
  rpc.mockResolvedValue({ data: { error: 'invalid_code' }, error: null });
  const err = await joinFamily('123456').catch((e) => e);
  expect(err).toBeInstanceOf(GroupError);
  expect(err.code).toBe('invalid_code');
});

it('maps raised messages and unknown errors', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'already_member' } });
  expect(await codeOf(joinFamily('123456'))).toBe('already_member');
  rpc.mockResolvedValue({ data: null, error: { message: 'too_many_attempts' } });
  expect(await codeOf(joinFamily('123456'))).toBe('too_many_attempts');
  rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
  expect(await codeOf(joinFamily('123456'))).toBe('network');
  rpc.mockRejectedValue(new TypeError('Network request failed'));
  expect(await codeOf(joinFamily('123456'))).toBe('network');
});

describe('other wrappers', () => {
  const from = supabase.from as unknown as jest.Mock;

  function mockQuery(...results: unknown[]) {
    const all = results.map((r) => chain(r));
    for (const c of all) from.mockReturnValueOnce(c.builder);
    return all.map((c) => c.calls);
  }

  beforeEach(() => jest.clearAllMocks());

  it('createFamily calls the RPC and returns the id', async () => {
    rpc.mockResolvedValue({ data: 'f1', error: null });
    await expect(api.createFamily('우리집')).resolves.toBe('f1');
    expect(rpc).toHaveBeenCalledWith('create_family', { p_name: '우리집' });
  });

  it('createFamily maps name required and treats null data as network', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'name required' } });
    expect(await codeOf(api.createFamily(' '))).toBe('name_required');
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await codeOf(api.createFamily('x'))).toBe('network');
  });

  it('leaveFamily calls the RPC and maps not_member', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(api.leaveFamily('f1')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('leave_family', { p_family_id: 'f1' });
    rpc.mockResolvedValue({ data: null, error: { message: 'not_member' } });
    expect(await codeOf(api.leaveFamily('f1'))).toBe('not_member');
  });

  it('regenerateInviteCode returns the new code', async () => {
    rpc.mockResolvedValue({ data: '01234567', error: null });
    await expect(api.regenerateInviteCode('f1')).resolves.toBe('01234567');
    expect(rpc).toHaveBeenCalledWith('regenerate_invite_code', { p_family_id: 'f1' });
  });

  it('familyIsEmpty calls family_is_empty', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(api.familyIsEmpty('f1')).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith('family_is_empty', { p_family_id: 'f1' });
  });

  it('renameFamily updates only the name', async () => {
    const [calls] = mockQuery({ data: null, error: null });
    await api.renameFamily('f1', '새 이름');
    expect(from).toHaveBeenCalledWith('families');
    expect(calls).toEqual([
      ['update', [{ name: '새 이름' }]],
      ['eq', ['id', 'f1']],
    ]);
  });

  it('fetchMyFamilies orders by created_at and maps errors', async () => {
    const [calls] = mockQuery({ data: [{ id: 'f1' }], error: null });
    await expect(api.fetchMyFamilies()).resolves.toEqual([{ id: 'f1' }]);
    expect(calls).toEqual([
      ['select', ['*']],
      ['order', ['created_at']],
    ]);
    mockQuery({ data: null, error: { message: 'TypeError: Network request failed' } });
    const err = await api.fetchMyFamilies().catch((e) => e);
    expect(err).toBeInstanceOf(GroupError);
    expect(err.code).toBe('network');
    // 연결 오류인지 판단할 수 있게 원래 오류를 cause로 남긴다.
    expect(err.cause).toEqual({ message: 'TypeError: Network request failed' });
  });

  it('fetchFamilyMembers joins display names and skips the profile query when there are no members', async () => {
    const [members, profiles] = mockQuery(
      {
        data: [
          { user_id: 'u1', joined_at: '1' },
          { user_id: 'u2', joined_at: '2' },
        ],
        error: null,
      },
      { data: [{ user_id: 'u1', display_name: '은정' }], error: null }
    );
    await expect(api.fetchFamilyMembers('f1')).resolves.toEqual([
      { user_id: 'u1', joined_at: '1', display_name: '은정' },
      { user_id: 'u2', joined_at: '2', display_name: null },
    ]);
    expect(members).toEqual([
      ['select', ['user_id, joined_at']],
      ['eq', ['family_id', 'f1']],
      ['order', ['joined_at']],
    ]);
    expect(profiles).toEqual([
      ['select', ['user_id, display_name']],
      ['in', ['user_id', ['u1', 'u2']]],
    ]);

    from.mockReset();
    mockQuery({ data: [], error: null });
    await expect(api.fetchFamilyMembers('f1')).resolves.toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
  });
});
