-- 보안 점검(/cso CSO-2): 초대 코드 무차별 대입 강화.
-- 6자리 → 8자리, 7일 만료, 계정 여러 개로 나눠 찍는 대입을 막는 전역 실패 상한.

-- 1) 8자리 코드 (5바이트 난수 → 편향 무시할 수준)
create or replace function public.gen_invite_code() returns text
language sql volatile set search_path = '' as $$
  select lpad(
    (('x' || encode(extensions.gen_random_bytes(5), 'hex'))::bit(40)::bigint % 100000000)::text,
    8, '0');
$$;
revoke execute on function public.gen_invite_code() from public, anon, authenticated;

-- 2) 만료 시각. 멤버가 연장하지 못하도록 컬럼 update 권한은 주지 않는다(0002의 name 전용 grant 유지).
alter table public.families
  add column invite_code_expires_at timestamptz not null default now() + interval '7 days';

-- 3) 기존 그룹 코드를 8자리로 재발급 (형식 제약은 재발급 후에 바꾼다)
alter table public.families drop constraint families_invite_code_check;
do $$
declare
  r record;
  i int;
begin
  for r in select id from public.families loop
    for i in 1..10 loop
      begin
        update public.families
        set invite_code = public.gen_invite_code(),
            invite_code_expires_at = now() + interval '7 days'
        where id = r.id;
        exit;
      exception when unique_violation then
        if i = 10 then raise; end if;
      end;
    end loop;
  end loop;
end;
$$;
alter table public.families
  add constraint families_invite_code_check check (invite_code ~ '^[0-9]{8}$');

-- 4) 전역 실패 상한 조회용 인덱스
create index join_attempts_attempted_at_idx on public.join_attempts (attempted_at);

create or replace function public.create_family(p_name text) returns uuid
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
      insert into public.families (name, invite_code, invite_code_expires_at, created_by)
      values (v_name, v_code, now() + interval '7 days', v_uid)
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

-- 성공: {"family_id": uuid} / 없거나 만료된 코드: {"error":"invalid_code"} (예외가 아니라 반환 -> 실패 기록이 커밋됨)
create or replace function public.join_family(p_code text) returns jsonb
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

  -- 전역 상한: 여러 계정으로 나눠 찍어도 전체 실패가 분당 30회를 넘지 못한다.
  if (select count(*) from public.join_attempts
      where not succeeded and attempted_at > now() - interval '1 minute') >= 30 then
    raise exception 'too_many_attempts';
  end if;

  select id into v_fid from public.families
  where invite_code = trim(coalesce(p_code, '')) and invite_code_expires_at > now();
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

create or replace function public.regenerate_invite_code(p_family_id uuid) returns text
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
      update public.families
      set invite_code = v_code, invite_code_expires_at = now() + interval '7 days'
      where id = p_family_id;
      return v_code;
    exception when unique_violation then
      null;
    end;
  end loop;
  raise exception 'could not generate invite code';
end;
$$;

revoke execute on function
  public.create_family(text), public.join_family(text), public.regenerate_invite_code(uuid)
  from public, anon;
grant execute on function
  public.create_family(text), public.join_family(text), public.regenerate_invite_code(uuid)
  to authenticated;
