import { liveSessionCheck } from '@/src/auth/session-check';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({ supabase: { auth: { getSession: jest.fn() } } }));
const getSession = supabase.auth.getSession as jest.Mock;

it('returns the session user id, or null without a session (F2, M-1)', async () => {
  getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } }, error: null });
  await expect(liveSessionCheck()).resolves.toBe('u1');
  getSession.mockResolvedValueOnce({ data: { session: null }, error: { name: 'AuthRetryableFetchError' } });
  await expect(liveSessionCheck()).resolves.toBeNull();
  getSession.mockRejectedValueOnce(new Error('storage'));
  await expect(liveSessionCheck()).resolves.toBeNull();
});
