-- 장소 검색 사용자별 할당량(/cso CSO-3): search_usage는 RPC 전용, consume_search_quota는 시간당 60회.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@test.dev');

select has_table('public', 'search_usage', 'search_usage exists');
select ok((select relrowsecurity from pg_class where oid = 'public.search_usage'::regclass), 'RLS enabled on search_usage');
select has_index('public', 'search_usage', 'search_usage_user_id_used_at_idx', 'index on (user_id, used_at)');
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.consume_search_quota()'::regprocedure),
  'consume_search_quota is security definer with empty search_path');

-- anon: 테이블/함수 모두 불가
set local role anon;
select throws_ok($$select count(*) from search_usage$$, '42501', null, 'anon cannot read search_usage');
select throws_ok($$select consume_search_quota()$$, '42501', null, 'anon cannot execute consume_search_quota');
reset role;

-- authenticated: 테이블 직접 접근 불가(RPC 전용)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select count(*) from search_usage$$, '42501', null, 'authenticated cannot read search_usage');
select throws_ok(
  $$insert into search_usage (user_id) values ('00000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'authenticated cannot insert into search_usage');
select throws_ok(
  $$delete from search_usage$$, '42501', null, 'authenticated cannot delete from search_usage');

-- 인증 없음
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select consume_search_quota()$$, 'P0001', 'not authenticated', 'consume_search_quota requires auth');

-- A: 시간당 60회까지 허용, 61번째 거부
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select bool_and(consume_search_quota()) from generate_series(1, 60)), true, 'first 60 searches allowed');
select is(consume_search_quota(), false, '61st search in the hour refused');
reset role;
select is((select count(*)::int from search_usage where user_id = '00000000-0000-0000-0000-0000000000a1'), 60, 'refused search is not recorded');

-- B: 1시간보다 오래된 사용은 세지 않고, 1일보다 오래된 기록은 지운다
insert into search_usage (user_id, used_at)
  select '00000000-0000-0000-0000-0000000000b1', now() - interval '2 hours' from generate_series(1, 60);
insert into search_usage (user_id, used_at)
  select '00000000-0000-0000-0000-0000000000b1', now() - interval '2 days' from generate_series(1, 5);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(consume_search_quota(), true, 'usage older than an hour does not count (and A''s usage is separate)');
reset role;
select is((select count(*)::int from search_usage
           where user_id = '00000000-0000-0000-0000-0000000000b1' and used_at < now() - interval '1 day'), 0,
  'usage older than a day pruned');
select is((select count(*)::int from search_usage where user_id = '00000000-0000-0000-0000-0000000000b1'), 61,
  'recent-but-old-hour usage kept, new use recorded');

-- 사용자 삭제 시 기록도 삭제
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1';
select is((select count(*)::int from search_usage where user_id = '00000000-0000-0000-0000-0000000000a1'), 0,
  'usage cascades on user delete');

select * from finish();
rollback;
