begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev');

insert into families (id, name, invite_code, created_by) values
  ('10000000-0000-0000-0000-00000000000a', 'A', '000001', '00000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-00000000000b', 'B', '000002', '00000000-0000-0000-0000-0000000000a1');

insert into lists (id, family_id, name, kind) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '사야할것', 'inbox'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '사야할것', 'inbox'),
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', '온라인', 'online');

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

delete from families where id = '10000000-0000-0000-0000-00000000000a';
select is(
  (select count(*) from lists where family_id = '10000000-0000-0000-0000-00000000000a')
  + (select count(*) from items where family_id = '10000000-0000-0000-0000-00000000000a'),
  0::bigint, 'family delete cascades to lists and items');

select * from finish();
rollback;
