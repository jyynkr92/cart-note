-- 초대 코드 강화(/cso CSO-2): 8자리, 7일 만료, 전역 실패 상한.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@test.dev'),
  ('00000000-0000-0000-0000-0000000000c1', 'c@test.dev'),
  ('00000000-0000-0000-0000-0000000000d1', 'd@test.dev');

-- 형식: 8자리만 허용
select throws_ok(
  $$insert into families (name, invite_code) values ('x', '123456')$$,
  '23514', null, '6-digit invite code rejected by check');
select col_not_null('families', 'invite_code_expires_at', 'invite_code_expires_at is not null');
select has_index('public', 'join_attempts', 'join_attempts_attempted_at_idx', 'index on join_attempts.attempted_at');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('t.fid', create_family('A네')::text, true);
select matches((select invite_code from families where id = current_setting('t.fid')::uuid), '^[0-9]{8}$', 'create_family makes an 8-digit code');
select ok(
  (select invite_code_expires_at between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute'
   from families where id = current_setting('t.fid')::uuid),
  'create_family sets expiry to 7 days');
select is((select count(*)::int from families where id = current_setting('t.fid')::uuid and invite_code_expires_at is not null), 1, 'member can read expiry');

-- 멤버도 만료 시각을 바꿀 수 없다(컬럼 update 권한 없음)
select throws_ok(
  $$update families set invite_code_expires_at = now() + interval '1 year' where id = current_setting('t.fid')::uuid$$,
  '42501', null, 'member cannot update invite_code_expires_at');
select lives_ok(
  $$update families set name = 'A네 집' where id = current_setting('t.fid')::uuid$$,
  'member can still rename');

-- 만료된 코드는 invalid_code (실패로 기록)
reset role;
update families set invite_code_expires_at = now() - interval '1 second' where id = current_setting('t.fid')::uuid;
select set_config('t.code', (select invite_code from families where id = current_setting('t.fid')::uuid), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select join_family(current_setting('t.code'))->>'error'), 'invalid_code', 'expired code returns invalid_code');
reset role;
select is((select count(*)::int from join_attempts where user_id = '00000000-0000-0000-0000-0000000000b1' and not succeeded), 1, 'expired attempt recorded as failure');
select is((select count(*)::int from family_members where family_id = current_setting('t.fid')::uuid), 1, 'expired code did not add a member');

-- 재발급하면 새 8자리 코드와 새 만료 시각
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('t.newcode', regenerate_invite_code(current_setting('t.fid')::uuid), true);
select matches(current_setting('t.newcode'), '^[0-9]{8}$', 'regenerated code is 8 digits');
select ok(
  (select invite_code_expires_at > now() + interval '7 days' - interval '1 minute'
   from families where id = current_setting('t.fid')::uuid),
  'regenerate resets expiry');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select join_family(current_setting('t.newcode'))->>'family_id'), current_setting('t.fid'), 'fresh code joins');

-- 전역 실패 상한: 최근 1분 동안 전체 실패 30회 이상이면 누구든 too_many_attempts
reset role;
delete from join_attempts;
-- 1분보다 오래된 실패는 세지 않는다
insert into join_attempts (user_id, attempted_at, succeeded)
  select '00000000-0000-0000-0000-0000000000b1', now() - interval '2 minutes', false from generate_series(1, 40);
-- 다른 사용자들의 최근 실패 29회 (사용자당 상한 10 미만으로 나눔)
insert into join_attempts (user_id, succeeded)
  select '00000000-0000-0000-0000-0000000000b1', false from generate_series(1, 9);
insert into join_attempts (user_id, succeeded)
  select '00000000-0000-0000-0000-0000000000a1', false from generate_series(1, 9);
insert into join_attempts (user_id, succeeded)
  select '00000000-0000-0000-0000-0000000000d1', false from generate_series(1, 9);
insert into join_attempts (user_id, succeeded)
  select '00000000-0000-0000-0000-0000000000c1', false from generate_series(1, 2);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select join_family('00000000')->>'error'), 'invalid_code', '29 recent global failures: still allowed (now 30)');
select throws_ok($$select join_family(current_setting('t.newcode'))$$, 'P0001', 'too_many_attempts', '30 recent global failures: even a valid code is throttled');
reset role;
select is((select count(*)::int from family_members where family_id = current_setting('t.fid')::uuid and user_id = '00000000-0000-0000-0000-0000000000c1'), 0, 'throttled user not added');
select is((select count(*)::int from join_attempts where attempted_at > now() - interval '1 minute' and not succeeded), 30, 'global failures stay recorded');

-- 기존 패턴 유지: gen_invite_code는 앱 역할이 실행할 수 없다
set local role authenticated;
select throws_ok($$select gen_invite_code()$$, '42501', null, 'authenticated cannot execute gen_invite_code');

select * from finish();
rollback;
