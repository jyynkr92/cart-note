-- 0008: 좌표/반경 범위(A4)와 텍스트 길이(A13) CHECK.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev');

insert into families (id, name, invite_code, created_by) values
  ('10000000-0000-0000-0000-00000000000a', 'A', '00000001', '00000000-0000-0000-0000-0000000000a1');
insert into lists (id, family_id, name, kind) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '사야할것', 'inbox'),
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', '마트', 'store');

create function pg_temp.loc(p_lat double precision, p_lng double precision, p_radius int)
returns void language sql as $$
  insert into public.list_locations (list_id, family_id, place_name, lat, lng, radius_m)
  values ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', 'p', p_lat, p_lng, p_radius);
$$;

-- A4: 좌표/반경 범위
select lives_ok($$select pg_temp.loc(-90, -180, 50)$$, 'lower bounds accepted');
select lives_ok($$select pg_temp.loc(90, 180, 5000)$$, 'upper bounds accepted');
select lives_ok($$select pg_temp.loc(37.5, 127.0, 300)$$, 'typical location accepted');
select throws_ok($$select pg_temp.loc(90.0001, 0, 300)$$, '23514', null, 'lat > 90 rejected');
select throws_ok($$select pg_temp.loc(-90.0001, 0, 300)$$, '23514', null, 'lat < -90 rejected');
select throws_ok($$select pg_temp.loc(0, 180.0001, 300)$$, '23514', null, 'lng > 180 rejected');
select throws_ok($$select pg_temp.loc(0, -180.0001, 300)$$, '23514', null, 'lng < -180 rejected');
select throws_ok($$select pg_temp.loc('NaN', 0, 300)$$, '23514', null, 'lat NaN rejected');
select throws_ok($$select pg_temp.loc(0, 'NaN', 300)$$, '23514', null, 'lng NaN rejected');
select throws_ok($$select pg_temp.loc('Infinity', 0, 300)$$, '23514', null, 'lat Infinity rejected');
select throws_ok($$select pg_temp.loc(0, '-Infinity', 300)$$, '23514', null, 'lng -Infinity rejected');
select throws_ok($$select pg_temp.loc(0, 0, 49)$$, '23514', null, 'radius < 50 rejected');
select throws_ok($$select pg_temp.loc(0, 0, 5001)$$, '23514', null, 'radius > 5000 rejected');
select throws_ok(
  $$update list_locations set lat = 'NaN' where lat = 37.5$$,
  '23514', null, 'update to NaN rejected');

-- A13: 텍스트 길이(문자 수)
insert into profiles (user_id, display_name) values ('00000000-0000-0000-0000-0000000000a1', repeat('가', 50));
select throws_ok(
  $$update profiles set display_name = repeat('가', 51) where user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  '23514', null, 'display_name > 50 rejected');
select lives_ok(
  $$update families set name = repeat('가', 50) where id = '10000000-0000-0000-0000-00000000000a'$$,
  'families.name 50 accepted');
select throws_ok(
  $$update families set name = repeat('가', 51) where id = '10000000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'families.name > 50 rejected');
select lives_ok(
  $$update lists set name = repeat('가', 50) where id = '20000000-0000-0000-0000-0000000000c2'$$,
  'lists.name 50 accepted');
select throws_ok(
  $$update lists set name = repeat('가', 51) where id = '20000000-0000-0000-0000-0000000000c2'$$,
  '23514', null, 'lists.name > 50 rejected');
select lives_ok(
  $$insert into items (list_id, family_id, name, note) values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', repeat('가', 200), repeat('가', 1000))$$,
  'items.name 200 / note 1000 accepted');
select throws_ok(
  $$insert into items (list_id, family_id, name) values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', repeat('가', 201))$$,
  '23514', null, 'items.name > 200 rejected');
select throws_ok(
  $$insert into items (list_id, family_id, name, note) values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'x', repeat('가', 1001))$$,
  '23514', null, 'items.note > 1000 rejected');
select lives_ok(
  $$insert into list_locations (list_id, family_id, place_name, address, lat, lng) values ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', repeat('가', 200), repeat('가', 300), 1, 1)$$,
  'place_name 200 / address 300 accepted');
select throws_ok(
  $$insert into list_locations (list_id, family_id, place_name, lat, lng) values ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', repeat('가', 201), 1, 1)$$,
  '23514', null, 'place_name > 200 rejected');
select throws_ok(
  $$insert into list_locations (list_id, family_id, place_name, address, lat, lng) values ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', 'p', repeat('가', 301), 1, 1)$$,
  '23514', null, 'address > 300 rejected');
select lives_ok(
  $$insert into list_locations (list_id, family_id, place_name, address, lat, lng) values ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', 'p', null, 1, 1)$$,
  'null address accepted');

-- RPC 경로도 같은 제약을 받는다.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select create_family(repeat('가', 51))$$, '23514', null, 'create_family with a long name rejected');
select lives_ok($$select create_family(repeat('가', 50))$$, 'create_family with a 50-char name accepted');
reset role;

-- 제약 이름이 고정돼 있어야 이후 마이그레이션에서 다룰 수 있다.
select col_has_check('public', 'list_locations', 'lat', 'lat has a check');
select col_has_check('public', 'list_locations', 'radius_m', 'radius_m has a check');

select * from finish();
rollback;
