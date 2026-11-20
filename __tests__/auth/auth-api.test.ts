import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { exchangeCodeFromUrl, parseAuthCode, refreshSession, signOut } from '@/src/auth/auth-api';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      setSession: jest.fn(),
      refreshSession: jest.fn(),
    },
  },
}));

beforeEach(() => jest.clearAllMocks());

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

describe('parseAuthCode', () => {
  it('reads the PKCE code from the query', () => {
    expect(parseAuthCode('cartnote://auth?code=abc-123')).toEqual({ code: 'abc-123' });
    expect(parseAuthCode('cartnote://auth/?code=abc')).toEqual({ code: 'abc' });
  });
  it('passes a valid flow id through', () => {
    const flowId = '0123456789abcdef0123456789abcdef';
    expect(parseAuthCode(`cartnote://auth?sb_flow_id=${flowId}&code=abc`)).toEqual({ code: 'abc', flowId });
  });
  it('returns null without a code', () => {
    expect(parseAuthCode('cartnote://auth')).toBeNull();
    expect(parseAuthCode('cartnote://auth?code=')).toBeNull();
    expect(parseAuthCode('cartnote://auth?error=access_denied&error_code=otp_expired')).toBeNull();
  });
  it('rejects token fragments (implicit flow is not accepted)', () => {
    expect(parseAuthCode('cartnote://auth#access_token=a&refresh_token=b')).toBeNull();
    expect(parseAuthCode('cartnote://auth?code=abc#access_token=a&refresh_token=b')).toBeNull();
  });
  it('rejects other hosts and schemes', () => {
    expect(parseAuthCode('https://evil.example/auth?code=abc')).toBeNull();
    expect(parseAuthCode('cartnote://other?code=abc')).toBeNull();
    expect(parseAuthCode('cartnote://auth.evil.com?code=abc')).toBeNull();
    expect(parseAuthCode('cartnote://authx?code=abc')).toBeNull();
  });
});

describe('exchangeCodeFromUrl', () => {
  const exchange = () => supabase.auth.exchangeCodeForSession as jest.Mock;

  it('exchanges the code (the verifier only exists on the requesting device)', async () => {
    exchange().mockResolvedValue({ data: {}, error: null });
    await exchangeCodeFromUrl('cartnote://auth?code=abc');
    expect(exchange()).toHaveBeenCalledWith('abc', undefined);
  });

  it('throws when the exchange fails (foreign or expired code)', async () => {
    exchange().mockResolvedValue({ data: {}, error: new Error('code verifier missing') });
    await expect(exchangeCodeFromUrl('cartnote://auth?code=foreign')).rejects.toThrow();
  });

  it('never touches the server for token fragment links', async () => {
    await expect(
      exchangeCodeFromUrl('cartnote://auth#access_token=a&refresh_token=b'),
    ).rejects.toThrow();
    expect(exchange()).not.toHaveBeenCalled();
    expect(supabase.auth.setSession).not.toHaveBeenCalled();
  });
});

describe('refreshSession (F6)', () => {
  it('asks auth-js to refresh and never throws', async () => {
    (supabase.auth.refreshSession as jest.Mock).mockResolvedValueOnce({ data: {}, error: null });
    await expect(refreshSession()).resolves.toBeUndefined();
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
    (supabase.auth.refreshSession as jest.Mock).mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(refreshSession()).resolves.toBeUndefined();
  });
});
