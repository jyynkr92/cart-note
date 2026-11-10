begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- 시드 (postgres 권한): A, C는 family X / B는 family Y
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@test.dev'),
  ('00000000-0000-0000-0000-0000000000c1', 'c@test.dev');

insert into profiles (user_id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'A'),
  ('00000000-0000-0000-0000-0000000000b1', 'B'),
  ('00000000-0000-0000-0000-0000000000c1', 'C');

insert into families (id, name, invite_code, created_by) values
  ('10000000-0000-0000-0000-00000000000a', 'X', '000001', '00000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-00000000000b', 'Y', '000002', '00000000-0000-0000-0000-0000000000b1');

insert into family_members (family_id, user_id) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1');

insert into lists (id, family_id, name, kind) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '사야할것', 'inbox'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '사야할것', 'inbox'),
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', '마트', 'store'),
  ('20000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-00000000000b', '약국', 'store');

insert into list_locations (list_id, family_id, place_name, lat, lng) values
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', '이마트', 37.5, 127.0),
  ('20000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-00000000000b', '약국', 37.6, 127.1);

insert into items (list_id, family_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'milk'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'egg'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'beer');

-- anon: 아무것도 못 봄
set local role anon;
select throws_ok($$select count(*) from items$$, '42501', null, 'anon cannot read items');
select throws_ok($$select count(*) from lists$$, '42501', null, 'anon cannot read lists');
select throws_ok($$select count(*) from families$$, '42501', null, 'anon cannot read families');
select throws_ok($$select count(*) from profiles$$, '42501', null, 'anon cannot read profiles');
reset role;

-- A로 전환
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from items), 2, 'A sees only family X items');
select is((select count(*)::int from lists), 2, 'A sees only family X lists');
select is((select count(*)::int from family_members), 2, 'A sees all members of own family only');
select is((select count(*)::int from families), 1, 'A sees only own family');

select throws_ok(
  $$insert into items (list_id, family_id, name) values ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'x')$$,
  '42501', null, 'A cannot insert item into family Y');

select lives_ok(
  $$insert into items (list_id, family_id, name) values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'bread')$$,
  'A can insert item into own family');

with u as (update families set name = 'hacked' where id = '10000000-0000-0000-0000-00000000000b' returning 1)
select is((select count(*)::int from u), 0, 'A update of family Y affects 0 rows');

with u as (update families set name = 'X2' where id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from u), 1, 'A can rename own family');

select throws_ok(
  $$insert into families (name, invite_code) values ('new', '999999')$$,
  '42501', null, 'direct family insert denied');

select throws_ok(
  $$insert into family_members (family_id, user_id) values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'direct family_members insert denied');

select is((select count(*)::int from profiles where user_id = '00000000-0000-0000-0000-0000000000c1'), 1,
  'A can read profile of same-family member C');
select is((select count(*)::int from profiles where user_id = '00000000-0000-0000-0000-0000000000b1'), 0,
  'A cannot read profile of B');

with u as (update profiles set display_name = 'hack' where user_id = '00000000-0000-0000-0000-0000000000c1' returning 1)
select is((select count(*)::int from u), 0, 'A cannot update C profile');

-- guard_list_update 트리거는 RLS 하에서도 멤버의 위치를 볼 수 있어야 함
select throws_ok(
  $$update lists set kind = 'online' where id = '20000000-0000-0000-0000-0000000000c2'$$,
  null, 'list has locations', 'guard trigger still sees locations under RLS');

-- 컬럼 단위 update 제한
select throws_ok($$update families set invite_code = '424242' where id = '10000000-0000-0000-0000-00000000000a'$$,
  '42501', null, 'member cannot change invite_code');
select throws_ok($$update families set created_by = '00000000-0000-0000-0000-0000000000b1' where id = '10000000-0000-0000-0000-00000000000a'$$,
  '42501', null, 'member cannot change created_by');
select throws_ok($$update items set family_id = '10000000-0000-0000-0000-00000000000b' where name = 'milk'$$,
  '42501', null, 'member cannot change items.family_id');

-- created_by 위조 방지
insert into items (id, list_id, family_id, name, created_by) values
  ('30000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'forged', '00000000-0000-0000-0000-0000000000b1');
select is((select created_by from items where id = '30000000-0000-0000-0000-0000000000f1'),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'created_by forced to caller');

-- updated_at 트리거는 컬럼 권한과 무관하게 동작
select lives_ok($$update items set is_done = true where id = '30000000-0000-0000-0000-0000000000f1'$$,
  'member can update allowed item columns');

-- 타 가족(Y) 행에 대한 영향 0
with u as (update items set name = 'x' where family_id = '10000000-0000-0000-0000-00000000000b' returning 1)
select is((select count(*)::int from u), 0, 'A update on Y items: 0 rows');
with d as (delete from items where family_id = '10000000-0000-0000-0000-00000000000b' returning 1)
select is((select count(*)::int from d), 0, 'A delete on Y items: 0 rows');
with u as (update lists set name = 'x' where family_id = '10000000-0000-0000-0000-00000000000b' returning 1)
select is((select count(*)::int from u), 0, 'A update on Y lists: 0 rows');
with d as (delete from lists where family_id = '10000000-0000-0000-0000-00000000000b' returning 1)
select is((select count(*)::int from d), 0, 'A delete on Y lists: 0 rows');
with u as (update list_locations set place_name = 'x' where family_id = '10000000-0000-0000-0000-00000000000b' returning 1)
select is((select count(*)::int from u), 0, 'A update on Y list_locations: 0 rows');
with d as (delete from list_locations where family_id = '10000000-0000-0000-0000-00000000000b' returning 1)
select is((select count(*)::int from d), 0, 'A delete on Y list_locations: 0 rows');
select is((select count(*)::int from list_locations where family_id = '10000000-0000-0000-0000-00000000000b'), 0,
  'A cannot see Y list_locations');
with d as (delete from families where id = '10000000-0000-0000-0000-00000000000b' returning 1)
select is((select count(*)::int from d), 0, 'A delete on Y family: 0 rows');
with d as (delete from family_members where family_id = '10000000-0000-0000-0000-00000000000b' returning 1)
select is((select count(*)::int from d), 0, 'A delete on Y family_members: 0 rows');

reset role;
select is((select count(*)::int from items), 5, 'postgres sees all items (sanity)');

select * from finish();
rollback;
