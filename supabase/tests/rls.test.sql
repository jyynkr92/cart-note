begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', '마트', 'store');

insert into list_locations (list_id, family_id, place_name, lat, lng) values
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', '이마트', 37.5, 127.0);

insert into items (list_id, family_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'milk'),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'egg'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'beer');

-- anon: 아무것도 못 봄
set local role anon;
select throws_ok($$select count(*) from items$$, '42501', null, 'anon cannot read items');
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

reset role;
select is((select count(*)::int from items), 4, 'postgres sees all items (sanity)');

select * from finish();
rollback;
