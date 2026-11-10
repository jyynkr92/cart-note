import { GroupError, joinFamily } from '@/src/groups/group-api';
import { supabase } from '@/src/lib/supabase';

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
