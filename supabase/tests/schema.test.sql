begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev');

insert into families (id, name, invite_code, created_by) values
  ('10000000-0000-0000-0000-00000000000a', 'A', '00000001', '00000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-00000000000b', 'B', '00000002', '00000000-0000-0000-0000-0000000000a1');

insert into lists (id, family_id, name, kind) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '사야할것', 'inbox'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '사야할것', 'inbox'),
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', '온라인', 'online'),
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', '마트', 'store');

select throws_ok(
  $$insert into lists (family_id, name, kind) values ('10000000-0000-0000-0000-00000000000a', 'x', 'inbox')$$,
  '23505', null, 'second inbox in same family rejected');

select throws_ok(
  $$delete from lists where id = '20000000-0000-0000-0000-00000000000a'$$,
  null, 'inbox list cannot be deleted', 'inbox delete blocked');

select throws_ok(
  $$insert into items (list_id, family_id, name) values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000b', 'milk')$$,
  '23503', null, 'item with mismatched family rejected');

insert into items (id, list_id, family_id, name) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'milk');

select throws_ok(
  $$update items set list_id = '20000000-0000-0000-0000-00000000000b' where id = '30000000-0000-0000-0000-000000000001'$$,
  '23503', null, 'moving item to other family list rejected');

select throws_ok(
  $$insert into list_locations (list_id, family_id, place_name, lat, lng) values ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'p', 37.5, 127.0)$$,
  null, 'locations only allowed on store lists', 'location on non-store list rejected');

select lives_ok(
  $$insert into list_locations (list_id, family_id, place_name, lat, lng) values ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', 'p', 37.5, 127.0)$$,
  'location on store list allowed');

select is((select radius_m from list_locations where place_name = 'p'), 300, 'radius_m defaults to 300');

insert into list_locations (list_id, family_id, place_name, lat, lng, kakao_place_id) values
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', 'k', 37.5, 127.0, 'kakao-1');

select throws_ok(
  $$insert into list_locations (list_id, family_id, place_name, lat, lng, kakao_place_id) values ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', 'k again', 37.5, 127.0, 'kakao-1')$$,
  '23505', null, 'same kakao_place_id twice on one list rejected');

select lives_ok(
  $$insert into list_locations (list_id, family_id, place_name, lat, lng) values ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-00000000000a', 'manual 2', 37.5, 127.0)$$,
  'locations without kakao_place_id are not constrained');

select throws_ok(
  $$update lists set kind = 'online' where id = '20000000-0000-0000-0000-00000000000a'$$,
  null, 'inbox kind cannot change', 'inbox kind change blocked');

select throws_ok(
  $$update lists set kind = 'online' where id = '20000000-0000-0000-0000-0000000000c2'$$,
  null, 'list has locations', 'store with locations cannot change kind');

select throws_ok(
  $$update lists set family_id = '10000000-0000-0000-0000-00000000000b' where id = '20000000-0000-0000-0000-0000000000c1'$$,
  null, 'family_id is immutable', 'list family_id immutable');

delete from families where id = '10000000-0000-0000-0000-00000000000a';
select is(
  (select count(*) from lists where family_id = '10000000-0000-0000-0000-00000000000a')
  + (select count(*) from items where family_id = '10000000-0000-0000-0000-00000000000a'),
  0::bigint, 'family delete cascades to lists and items');


select is(
  (select count(*) from lists where family_id = '10000000-0000-0000-0000-00000000000b'),
  1::bigint, 'other family lists survive family delete');

select * from finish();
rollback;
