begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@test.dev'),
  ('00000000-0000-0000-0000-0000000000c1', 'c@test.dev');

-- anon: RPC 실행 불가
set local role anon;
select throws_ok($$select create_family('x')$$, '42501', null, 'anon cannot create_family');
select throws_ok($$select join_family('123456')$$, '42501', null, 'anon cannot join_family');
reset role;

-- 인증 없음
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select create_family('x')$$, 'P0001', 'not authenticated', 'create_family requires auth');
select throws_ok($$select join_family('123456')$$, 'P0001', 'not authenticated', 'join_family requires auth');

-- A: 생성
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select create_family('   ')$$, 'P0001', 'name required', 'blank name rejected');
select set_config('t.fid', create_family('  내 장보기  ')::text, true);
select is((select name from families where id = current_setting('t.fid')::uuid), '내 장보기', 'name trimmed');
select is((select count(*)::int from lists where family_id = current_setting('t.fid')::uuid and kind = 'inbox' and name = '사야할것' and sort_order = 0), 1, 'one inbox created');
select is((select count(*)::int from family_members where family_id = current_setting('t.fid')::uuid and user_id = '00000000-0000-0000-0000-0000000000a1'), 1, 'caller is member');
select matches((select invite_code from families where id = current_setting('t.fid')::uuid), '^[0-9]{6}$', 'invite code is 6 digits');
select set_config('t.code', (select invite_code from families where id = current_setting('t.fid')::uuid), true);

-- B: 참여
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select family_item_count(current_setting('t.fid')::uuid)$$, 'P0001', 'not_member', 'non-member item count denied');
select throws_ok($$select regenerate_invite_code(current_setting('t.fid')::uuid)$$, 'P0001', 'not_member', 'non-member regenerate denied');
select throws_ok($$select leave_family(current_setting('t.fid')::uuid)$$, 'P0001', 'not_member', 'non-member leave denied');
select is((select join_family(current_setting('t.code'))->>'family_id'), current_setting('t.fid'), 'B joins, gets family_id');
select is((select count(*)::int from family_members where family_id = current_setting('t.fid')::uuid), 2, 'two members');
select throws_ok($$select join_family(current_setting('t.code'))$$, 'P0001', 'already_member', 'repeat join rejected');
select is((select join_family('000000')->>'error'), 'invalid_code', 'unknown code returns invalid_code');
select is((select family_item_count(current_setting('t.fid')::uuid)), 0, 'item count 0');
insert into items (list_id, family_id, name)
  select id, family_id, 'milk' from lists where family_id = current_setting('t.fid')::uuid and kind = 'inbox';
select is((select family_item_count(current_setting('t.fid')::uuid)), 1, 'item count 1');

-- regenerate 후 이전 코드 무효 (C로 시도)
select set_config('t.newcode', regenerate_invite_code(current_setting('t.fid')::uuid), true);
select matches(current_setting('t.newcode'), '^[0-9]{6}$', 'new code is 6 digits');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select join_family(current_setting('t.code'))->>'error'), case when current_setting('t.code') = current_setting('t.newcode') then 'x' else 'invalid_code' end, 'old code rejected');

-- join_attempts 직접 접근 불가
select throws_ok($$select count(*) from join_attempts$$, '42501', null, 'join_attempts not readable by authenticated');

select throws_ok($$select gen_invite_code()$$, '42501', null, 'authenticated cannot execute gen_invite_code');

-- 무차별 대입 제한 경계: 위 old code 1회 + 8회 = 실패 9회 후에도 10번째 시도는 허용
select join_family('00000000') from generate_series(1, 8);
select is((select join_family('00000000')->>'error'), 'invalid_code', '10th attempt (after 9 failures) still allowed');
-- 실패 10회 후에는 올바른 코드도 거부
select throws_ok($$select join_family(current_setting('t.newcode'))$$, 'P0001', 'too_many_attempts', '11th attempt with valid code throttled');
-- 퇴장
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($$select leave_family(current_setting('t.fid')::uuid)$$, 'B leaves');
reset role;
select is((select count(*)::int from families where id = current_setting('t.fid')::uuid), 1, 'family stays with one member');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select leave_family(current_setting('t.fid')::uuid)$$, 'last member leaves');
reset role;
select is((select count(*)::int from families where id = current_setting('t.fid')::uuid), 0, 'family deleted');
select is((select count(*)::int from lists where family_id = current_setting('t.fid')::uuid), 0, 'lists (incl. inbox) and items cascaded');

select * from finish();
rollback;
