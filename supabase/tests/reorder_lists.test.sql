-- 0011: reorder_lists — 목록 순서를 한 번에 저장한다(inbox 제외, 빠진 목록은 뒤에 붙임).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@test.dev');

select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.reorder_lists(uuid, uuid[])'::regprocedure),
  'reorder_lists is security definer with empty search_path');
select ok(not has_function_privilege('anon', 'public.reorder_lists(uuid, uuid[])', 'execute'), 'anon cannot execute');
select ok(has_function_privilege('authenticated', 'public.reorder_lists(uuid, uuid[])', 'execute'), 'authenticated can execute');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('t.fam', create_family('우리')::text, true);
select set_config('t.other', create_family('다른')::text, true);

-- 목록 4개: s1(order 10), s2(20), s3(30), s4(40). inbox는 0001 기본값.
insert into lists (id, family_id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000c1', current_setting('t.fam')::uuid, 's1', 'store', 10),
  ('00000000-0000-0000-0000-0000000000c2', current_setting('t.fam')::uuid, 's2', 'store', 20),
  ('00000000-0000-0000-0000-0000000000c3', current_setting('t.fam')::uuid, 's3', 'online', 30),
  ('00000000-0000-0000-0000-0000000000c4', current_setting('t.fam')::uuid, 's4', 'store', 40);
insert into lists (id, family_id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000d1', current_setting('t.other')::uuid, 'o1', 'store', 77);
select set_config('t.inbox', (select id::text from lists where family_id = current_setting('t.fam')::uuid and kind = 'inbox'), true);
select set_config('t.inbox_order', (select sort_order::text from lists where id = current_setting('t.inbox')::uuid), true);

-- 순서대로 1..n, inbox id / 다른 그룹 id / 없는 id는 건너뛰고 번호를 쓰지 않는다. s4는 빠졌으므로 뒤에 붙는다.
select lives_ok(
  $$select reorder_lists(current_setting('t.fam')::uuid, array[
      '00000000-0000-0000-0000-0000000000c3'::uuid,
      current_setting('t.inbox')::uuid,
      '00000000-0000-0000-0000-0000000000d1'::uuid,
      gen_random_uuid(),
      '00000000-0000-0000-0000-0000000000c1'::uuid,
      '00000000-0000-0000-0000-0000000000c2'::uuid])$$,
  'reorder succeeds with foreign ids mixed in');
select is((select sort_order from lists where id = '00000000-0000-0000-0000-0000000000c3'), 1::double precision, 's3 first');
select is((select sort_order from lists where id = '00000000-0000-0000-0000-0000000000c1'), 2::double precision, 's1 second (skipped ids use no numbers)');
select is((select sort_order from lists where id = '00000000-0000-0000-0000-0000000000c2'), 3::double precision, 's2 third');
select is((select sort_order from lists where id = '00000000-0000-0000-0000-0000000000c4'), 4::double precision, 'omitted s4 appended after');
select is((select sort_order from lists where id = current_setting('t.inbox')::uuid), current_setting('t.inbox_order')::double precision, 'inbox sort_order unchanged');
select is((select sort_order from lists where id = '00000000-0000-0000-0000-0000000000d1'), 77::double precision, 'other group list untouched');

-- 빠진 목록이 여럿이면 기존 (sort_order, created_at) 순서를 유지한다.
select reorder_lists(current_setting('t.fam')::uuid, array['00000000-0000-0000-0000-0000000000c4'::uuid]);
select is(
  (select array_agg(id order by sort_order) from lists where family_id = current_setting('t.fam')::uuid and kind <> 'inbox'),
  array['00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2']::uuid[],
  'omitted lists keep prior relative order behind the given ones');

-- 중복 id: 첫 위치만 반영하고 오류 없이 지나간다.
select lives_ok(
  $$select reorder_lists(current_setting('t.fam')::uuid, array[
      '00000000-0000-0000-0000-0000000000c2'::uuid,
      '00000000-0000-0000-0000-0000000000c1'::uuid,
      '00000000-0000-0000-0000-0000000000c2'::uuid])$$,
  'duplicate ids do not raise');
select is(
  (select array_agg(id order by sort_order) from lists where family_id = current_setting('t.fam')::uuid and kind <> 'inbox'),
  array['00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000c3']::uuid[],
  'duplicate id: first position wins, rest keep prior order');

-- null p_ids: 오류 없이 기존 상대 순서를 유지하며 1..n으로 다시 매긴다.
select lives_ok(
  $$select reorder_lists(current_setting('t.fam')::uuid, null)$$,
  'null p_ids does not raise');
select is(
  (select array_agg(id::text || ':' || sort_order::text order by sort_order) from lists where family_id = current_setting('t.fam')::uuid and kind <> 'inbox'),
  array['00000000-0000-0000-0000-0000000000c2:1','00000000-0000-0000-0000-0000000000c1:2','00000000-0000-0000-0000-0000000000c4:3','00000000-0000-0000-0000-0000000000c3:4'],
  'null p_ids: relative order kept, numbered 1..n');

-- 로그인 정보(sub)가 없으면 예외.
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok(
  $$select reorder_lists(current_setting('t.fam')::uuid, array[]::uuid[])$$,
  'P0001', 'not authenticated', 'requires auth');

-- 멤버가 아니면 예외.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$select reorder_lists(current_setting('t.fam')::uuid, array[]::uuid[])$$,
  'P0001', 'not_member', 'non-member cannot reorder');

select * from finish();
rollback;
