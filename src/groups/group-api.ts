import { supabase } from '@/src/lib/supabase';
import type { Database } from '@/src/lib/database.types';

export type Family = Database['public']['Tables']['families']['Row'];
export type FamilyMember = { user_id: string; joined_at: string; display_name: string | null };

export type GroupErrorCode =
  | 'invalid_code'
  | 'already_member'
  | 'too_many_attempts'
  | 'not_member'
  | 'not_authenticated'
  | 'name_required'
  | 'network';

export class GroupError extends Error {
  /** cause: 원래 오류(연결 문제인지 구분할 때 쓴다). */
  constructor(
    public code: GroupErrorCode,
    cause?: unknown
  ) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'GroupError';
  }
}

const MESSAGE_CODES: Record<string, GroupErrorCode> = {
  invalid_code: 'invalid_code',
  already_member: 'already_member',
  too_many_attempts: 'too_many_attempts',
  not_member: 'not_member',
  'not authenticated': 'not_authenticated',
  'name required': 'name_required',
};

function required<T>(v: T | null): T {
  if (v === null) throw new GroupError('network');
  return v;
}

function toGroupError(e: unknown): GroupError {
  if (e instanceof GroupError) return e;
  const message = (e as { message?: unknown } | null)?.message;
  if (typeof message === 'string') {
    for (const [needle, code] of Object.entries(MESSAGE_CODES)) {
      if (message.includes(needle)) return new GroupError(code, e);
    }
  }
  return new GroupError('network', e);
}

async function rpcData<T>(call: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  let res;
  try {
    res = await call;
  } catch (e) {
    throw toGroupError(e);
  }
  if (res.error) throw toGroupError(res.error);
  return res.data;
}

export async function createFamily(name: string): Promise<string> {
  return required(await rpcData(supabase.rpc('create_family', { p_name: name })));
}

/** 성공 시 family id. 없는 코드는 GroupError('invalid_code'). */
export async function joinFamily(code: string): Promise<string> {
  const data = (await rpcData(supabase.rpc('join_family', { p_code: code }))) as {
    family_id?: string;
    error?: string;
  } | null;
  if (data?.error === 'invalid_code') throw new GroupError('invalid_code');
  if (!data?.family_id) throw new GroupError('network');
  return data.family_id;
}

export async function leaveFamily(id: string): Promise<void> {
  await rpcData(supabase.rpc('leave_family', { p_family_id: id }));
}

export async function regenerateInviteCode(id: string): Promise<string> {
  return required(await rpcData(supabase.rpc('regenerate_invite_code', { p_family_id: id })));
}

export async function renameFamily(id: string, name: string): Promise<void> {
  await rpcData(supabase.from('families').update({ name }).eq('id', id));
}

export async function fetchMyFamilies(): Promise<Family[]> {
  return (await rpcData(supabase.from('families').select('*').order('created_at'))) ?? [];
}

export async function fetchFamilyMembers(id: string): Promise<FamilyMember[]> {
  const members =
    (await rpcData(
      supabase.from('family_members').select('user_id, joined_at').eq('family_id', id).order('joined_at'),
    )) ?? [];
  const ids = members.map((m) => m.user_id);
  const profiles = ids.length
    ? ((await rpcData(supabase.from('profiles').select('user_id, display_name').in('user_id', ids))) ?? [])
    : [];
  const names = new Map(profiles.map((p) => [p.user_id, p.display_name]));
  return members.map((m) => ({ ...m, display_name: names.get(m.user_id) ?? null }));
}

/**
 * 잠근 상태에서 다시 빈 그룹인지 확인한 뒤 지운다(확인과 삭제 사이의 참여/항목 추가 경합 방지).
 * 지웠으면 true, 그 사이 비어 있지 않게 됐으면 false.
 */
export async function deleteFamilyIfEmpty(id: string): Promise<boolean> {
  return required(await rpcData(supabase.rpc('delete_family_if_empty', { p_family_id: id })));
}

/** 멤버가 나 혼자이고 항목·추가 목록·지점이 하나도 없으면 true(참여 후 정리 후보). */
export async function familyIsEmpty(id: string): Promise<boolean> {
  return required(await rpcData(supabase.rpc('family_is_empty', { p_family_id: id })));
}
