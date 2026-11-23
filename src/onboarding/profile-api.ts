import { supabase } from '@/src/lib/supabase';

export async function hasProfile(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/** profiles는 컬럼 grant 때문에 merge-upsert 불가 → 단순 insert. */
export async function createProfile(userId: string, displayName: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .insert({ user_id: userId, display_name: displayName });
  if (error) throw error;
}

/** display_name 컬럼만 UPDATE한다(grant 범위). */
export async function updateDisplayName(userId: string, displayName: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName })
    .eq('user_id', userId);
  if (error) throw error;
}
