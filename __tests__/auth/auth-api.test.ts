import { parseAuthFragment } from '@/src/auth/auth-api';

jest.mock('@/src/lib/supabase', () => ({ supabase: { auth: {} } }));

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
