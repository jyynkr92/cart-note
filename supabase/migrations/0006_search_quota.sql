-- 보안 점검(/cso CSO-3): kakao-place-search 사용자별 할당량.
-- 기록 테이블은 RPC 전용(join_attempts와 같은 패턴: RLS 활성 + 정책/권한 없음).
create table public.search_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  used_at timestamptz not null default now()
);
create index search_usage_user_id_used_at_idx on public.search_usage (user_id, used_at);
alter table public.search_usage enable row level security;
-- 기본 권한이 authenticated에 select/insert/update/delete를 주므로 명시적으로 모두 회수한다.
revoke all on public.search_usage from public, anon, authenticated;

-- 1시간에 60회까지. 허용이면 기록하고 true, 초과면 기록 없이 false.
create function public.consume_search_quota() returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- 동일 사용자의 병렬 요청 직렬화 (카운트 후 삽입 경합으로 상한 우회 방지)
  perform pg_advisory_xact_lock(hashtext('consume_search_quota:' || v_uid::text));

  delete from public.search_usage
  where user_id = v_uid and used_at < now() - interval '1 day';

  if (select count(*) from public.search_usage
      where user_id = v_uid and used_at > now() - interval '1 hour') >= 60 then
    return false;
  end if;

  insert into public.search_usage (user_id) values (v_uid);
  return true;
end;
$$;
revoke execute on function public.consume_search_quota() from public, anon;
grant execute on function public.consume_search_quota() to authenticated;
