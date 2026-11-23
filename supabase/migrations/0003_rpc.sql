-- 그룹 RPC. families/family_members 쓰기는 모두 security definer RPC로만 가능.

-- join_family 무차별 대입 제한용 기록 (RPC 전용: RLS 활성 + 정책/권한 없음)
create table public.join_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null
);
create index join_attempts_user_id_attempted_at_idx
  on public.join_attempts (user_id, attempted_at);
alter table public.join_attempts enable row level security;
revoke all on public.join_attempts from public, anon, authenticated;

-- 6자리 숫자 초대 코드 (pgcrypto 기반, 충돌 여부는 호출부에서 확인)
create function public.gen_invite_code() returns text
language sql volatile set search_path = '' as $$
  select lpad(
    (('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text,
    6, '0');
$$;
revoke execute on function public.gen_invite_code() from public, anon, authenticated;

create function public.create_family(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := trim(coalesce(p_name, ''));
  v_fid uuid;
  v_code text;
  i int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if v_name = '' then raise exception 'name required'; end if;

  for i in 1..10 loop
    v_code := public.gen_invite_code();
    begin
      insert into public.families (name, invite_code, created_by)
      values (v_name, v_code, v_uid)
      returning id into v_fid;
      exit;
    exception when unique_violation then
      v_fid := null;
    end;
  end loop;
  if v_fid is null then raise exception 'could not generate invite code'; end if;

  insert into public.family_members (family_id, user_id) values (v_fid, v_uid);
  insert into public.lists (family_id, name, kind, sort_order)
  values (v_fid, '사야할것', 'inbox', 0);
  return v_fid;
end;
$$;

-- 성공: {"family_id": uuid} / 없는 코드: {"error":"invalid_code"} (예외가 아니라 반환 -> 실패 기록이 커밋됨)
create function public.join_family(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_fid uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- 동일 사용자의 병렬 요청 직렬화 (카운트 후 삽입 경합으로 제한 우회 방지)
  perform pg_advisory_xact_lock(hashtext('join_family:' || v_uid::text));

  delete from public.join_attempts
  where user_id = v_uid and attempted_at < now() - interval '1 day';

  if (select count(*) from public.join_attempts
      where user_id = v_uid and not succeeded
        and attempted_at > now() - interval '10 minutes') >= 10 then
    raise exception 'too_many_attempts';
  end if;

  select id into v_fid from public.families where invite_code = trim(coalesce(p_code, ''));
  if v_fid is null then
    insert into public.join_attempts (user_id, succeeded) values (v_uid, false);
    return jsonb_build_object('error', 'invalid_code');
  end if;

  insert into public.family_members (family_id, user_id) values (v_fid, v_uid)
  on conflict do nothing;
  if not found then raise exception 'already_member'; end if;
  return jsonb_build_object('family_id', v_fid);
end;
$$;

create function public.leave_family(p_family_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  if not exists (select 1 from public.family_members where family_id = p_family_id and user_id = v_uid) then
    raise exception 'not_member';
  end if;

  -- 동시 leave 경합 방지: family 행 잠금
  perform 1 from public.families where id = p_family_id for update;

  delete from public.family_members where family_id = p_family_id and user_id = v_uid;
  if not found then raise exception 'not_member'; end if;

  if not exists (select 1 from public.family_members where family_id = p_family_id) then
    delete from public.families where id = p_family_id;
  end if;
end;
$$;

create function public.regenerate_invite_code(p_family_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text;
  i int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.family_members where family_id = p_family_id and user_id = v_uid) then
    raise exception 'not_member';
  end if;

  for i in 1..10 loop
    v_code := public.gen_invite_code();
    begin
      update public.families set invite_code = v_code where id = p_family_id;
      return v_code;
    exception when unique_violation then
      null;
    end;
  end loop;
  raise exception 'could not generate invite code';
end;
$$;

create function public.family_item_count(p_family_id uuid) returns int
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.family_members where family_id = p_family_id and user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return (select count(*)::int from public.items where family_id = p_family_id);
end;
$$;

revoke execute on function
  public.create_family(text), public.join_family(text), public.leave_family(uuid),
  public.regenerate_invite_code(uuid), public.family_item_count(uuid)
  from public, anon;
grant execute on function
  public.create_family(text), public.join_family(text), public.leave_family(uuid),
  public.regenerate_invite_code(uuid), public.family_item_count(uuid)
  to authenticated;
