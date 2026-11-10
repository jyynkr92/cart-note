import { supabase } from '@/src/lib/supabase';

export async function sendOtp(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: 'cartnote://auth' },
  });
  if (error) throw error;
}

export async function verifyOtp(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** `cartnote://auth#access_token=…&refresh_token=…` → tokens, or null. */
export function parseAuthFragment(
  url: string,
): { access_token: string; refresh_token: string } | null {
  const hashIndex = url.indexOf('#');
  if (hashIndex === -1) return null;
  const params = new URLSearchParams(url.slice(hashIndex + 1));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return null;
  return { access_token, refresh_token };
}

export async function setSessionFromUrl(url: string): Promise<void> {
  const tokens = parseAuthFragment(url);
  if (!tokens) return;
  const { error } = await supabase.auth.setSession(tokens);
  if (error) throw error;
}
