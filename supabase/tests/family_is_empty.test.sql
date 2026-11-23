-- 0009: family_is_empty — 참여 후 정리 프롬프트용 "빈 그룹" 판정(R4, A10).
-- 빈 그룹 = 멤버 1명(호출자), 항목 0개, inbox 외 목록 없음, 지점 없음.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@test.dev');

select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.family_is_empty(uuid)'::regprocedure),
  'family_is_empty is security definer with empty search_path');
select ok(
  not has_function_privilege('anon', 'public.family_is_empty(uuid)', 'execute'),
  'anon cannot execute family_is_empty');
select ok(
  has_function_privilege('authenticated', 'public.family_is_empty(uuid)', 'execute'),
  'authenticated can execute family_is_empty');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select family_is_empty(gen_random_uuid())$$, 'P0001', 'not authenticated', 'requires auth');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('t.fid', create_family('내 장보기')::text, true);
select is(family_is_empty(current_setting('t.fid')::uuid), true, 'fresh personal group is empty');

-- 항목
insert into items (id, list_id, family_id, name)
  select '30000000-0000-0000-0000-000000000001', id, family_id, 'milk'
  from lists where family_id = current_setting('t.fid')::uuid and kind = 'inbox';
select is(family_is_empty(current_setting('t.fid')::uuid), false, 'an item makes it non-empty');
delete from items where id = '30000000-0000-0000-0000-000000000001';
select is(family_is_empty(current_setting('t.fid')::uuid), true, 'empty again after deleting the item');

-- inbox 외 목록(빈 목록이어도)
insert into lists (id, family_id, name, kind)
  values ('20000000-0000-0000-0000-0000000000c2', current_setting('t.fid')::uuid, '코스트코', 'store');
select is(family_is_empty(current_setting('t.fid')::uuid), false, 'an extra (empty) list makes it non-empty');

-- 지점
insert into list_locations (list_id, family_id, place_name, lat, lng)
  values ('20000000-0000-0000-0000-0000000000c2', current_setting('t.fid')::uuid, '양재점', 37.46, 127.03);
select is(family_is_empty(current_setting('t.fid')::uuid), false, 'a location makes it non-empty');
delete from list_locations where list_id = '20000000-0000-0000-0000-0000000000c2';
delete from lists where id = '20000000-0000-0000-0000-0000000000c2';
select is(family_is_empty(current_setting('t.fid')::uuid), true, 'empty again after removing the list');

-- 다른 멤버
select set_config('t.code', (select invite_code from families where id = current_setting('t.fid')::uuid), true);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$select family_is_empty(current_setting('t.fid')::uuid)$$,
  'P0001', 'not_member', 'non-member cannot probe another group');
select is((select join_family(current_setting('t.code'))->>'family_id'), current_setting('t.fid'), 'B joins');
select is(family_is_empty(current_setting('t.fid')::uuid), false, 'a second member makes it non-empty (B view)');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(family_is_empty(current_setting('t.fid')::uuid), false, 'a second member makes it non-empty (A view)');

select * from finish();
rollback;
