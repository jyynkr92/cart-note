import { liveSessionCheck } from '@/src/auth/session-check';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({ supabase: { auth: { getSession: jest.fn() } } }));
const getSession = supabase.auth.getSession as jest.Mock;

it('is true only when getSession returns a session (F2)', async () => {
  getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } }, error: null });
  await expect(liveSessionCheck()).resolves.toBe(true);
  getSession.mockResolvedValueOnce({ data: { session: null }, error: { name: 'AuthRetryableFetchError' } });
  await expect(liveSessionCheck()).resolves.toBe(false);
  getSession.mockRejectedValueOnce(new Error('storage'));
  await expect(liveSessionCheck()).resolves.toBe(false);
});
