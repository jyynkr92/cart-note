-- 보안 점검(/cso CSO-2) 후속: 전역 참여 실패 상한이 정상 사용자를 막지 않게 한다.
-- 0005의 전역 상한은 계정 몇 개로 분당 30회 실패를 유지하면 모든 참여(올바른 코드 포함)를 막을 수 있었다.
-- 0005는 이미 적용됐을 수 있으므로 join_family만 다시 정의한다.

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

  -- 전역 상한: 전체 실패가 분당 30회 이상인 동안에는 최근 10분 안에 실패한 적이 있는 사용자만 막는다.
  -- 여러 계정으로 나눠 찍는 대입은 계정마다 실패 후 막히고, 실패가 없는 정상 사용자는 계속 참여할 수 있다.
  if exists (select 1 from public.join_attempts
             where user_id = v_uid and not succeeded
               and attempted_at > now() - interval '10 minutes')
     and (select count(*) from public.join_attempts
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

revoke execute on function public.join_family(text) from public, anon;
grant execute on function public.join_family(text) to authenticated;
