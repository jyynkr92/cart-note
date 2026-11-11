import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { parseAuthFragment, signOut } from '@/src/auth/auth-api';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({ supabase: { auth: { signOut: jest.fn() } } }));

describe('signOut', () => {
  it('signs out locally so it works offline', async () => {
    (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error: null });
    await signOut();
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('treats an offline network failure as signed out (the local session is already gone)', async () => {
    (supabase.auth.signOut as jest.Mock).mockResolvedValue({
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    });
    await expect(signOut()).resolves.toBeUndefined();
  });

  it('still throws other errors', async () => {
    (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error: new Error('boom') });
    await expect(signOut()).rejects.toThrow('boom');
  });
});

describe('parseAuthFragment', () => {
  it('parses tokens from the fragment', () => {
    expect(
      parseAuthFragment('cartnote://auth#access_token=abc&refresh_token=def&type=magiclink'),
    ).toEqual({ access_token: 'abc', refresh_token: 'def' });
  });
  it('returns null when tokens are missing', () => {
    expect(parseAuthFragment('cartnote://auth')).toBeNull();
    expect(parseAuthFragment('cartnote://auth#access_token=abc')).toBeNull();
    expect(parseAuthFragment('cartnote://auth#error=access_denied')).toBeNull();
  });
});

describe('parseAuthFragment rejects foreign links', () => {
  it('rejects other hosts and schemes', () => {
    expect(parseAuthFragment('https://evil.example/#access_token=a&refresh_token=b')).toBeNull();
    expect(parseAuthFragment('cartnote://other#access_token=a&refresh_token=b')).toBeNull();
    expect(parseAuthFragment('cartnote://auth.evil.com#access_token=a&refresh_token=b')).toBeNull();
    expect(parseAuthFragment('cartnote://authx#access_token=a&refresh_token=b')).toBeNull();
  });
  it('rejects a missing refresh_token', () => {
    expect(parseAuthFragment('cartnote://auth#access_token=a&refresh_token=')).toBeNull();
  });
});
