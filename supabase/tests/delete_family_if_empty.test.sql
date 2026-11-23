-- 0010: delete_family_if_empty — 참여 후 정리에서 "확인 후 삭제" 사이의 경합을 막는 원자적 삭제(B9).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@test.dev');

select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.delete_family_if_empty(uuid)'::regprocedure),
  'delete_family_if_empty is security definer with empty search_path');
select ok(not has_function_privilege('anon', 'public.delete_family_if_empty(uuid)', 'execute'), 'anon cannot execute');
select ok(has_function_privilege('authenticated', 'public.delete_family_if_empty(uuid)', 'execute'), 'authenticated can execute');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select delete_family_if_empty(gen_random_uuid())$$, 'P0001', 'not authenticated', 'requires auth');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('t.empty', create_family('내 장보기')::text, true);
select set_config('t.busy', create_family('항목 있음')::text, true);
insert into items (list_id, family_id, name)
  select id, family_id, 'milk' from lists where family_id = current_setting('t.busy')::uuid and kind = 'inbox';

-- 항목이 생긴 그룹은 지우지 않는다(false), 그대로 남는다.
select is(delete_family_if_empty(current_setting('t.busy')::uuid), false, 'non-empty group is not deleted');
select is((select count(*)::int from families where id = current_setting('t.busy')::uuid), 1, 'non-empty group still exists');
select is((select count(*)::int from items where family_id = current_setting('t.busy')::uuid), 1, 'its items are kept');

-- 다른 멤버가 들어온 그룹도 지우지 않는다.
select set_config('t.shared', create_family('같이')::text, true);
select set_config('t.code', (select invite_code from families where id = current_setting('t.shared')::uuid), true);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$select delete_family_if_empty(current_setting('t.empty')::uuid)$$,
  'P0001', 'not_member', 'non-member cannot delete');
select is((select join_family(current_setting('t.code'))->>'family_id'), current_setting('t.shared'), 'B joins the shared group');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(delete_family_if_empty(current_setting('t.shared')::uuid), false, 'group with a second member is not deleted');
select is((select count(*)::int from family_members where family_id = current_setting('t.shared')::uuid), 2, 'both members stay');

-- 빈 그룹은 지운다(목록/멤버도 함께).
select is(delete_family_if_empty(current_setting('t.empty')::uuid), true, 'empty group is deleted');
reset role;
select is((select count(*)::int from families where id = current_setting('t.empty')::uuid), 0, 'family row is gone');
select is((select count(*)::int from lists where family_id = current_setting('t.empty')::uuid), 0, 'its inbox is gone');

select * from finish();
rollback;
