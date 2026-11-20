-- 테이블 권한 계약: authenticated의 UPDATE는 컬럼 단위로만 준다(0002_rls.sql).
-- 기본 권한(default privileges)은 anon만 막았고 authenticated에는 새 테이블마다 테이블 전체
-- UPDATE를 준다. 그래서 새 테이블은 만들 때 `revoke update ... from authenticated` 뒤에
-- 바꿔도 되는 컬럼만 `grant update (cols)` 해야 한다(아예 막을 테이블은 revoke all).
-- 컬럼 grant가 있으면 PostgREST merge upsert(ON CONFLICT DO UPDATE)는 넣는 모든 컬럼(id,
-- family_id 포함)에 UPDATE가 필요해 42501로 실패한다. 재생해도 안전한 오프라인 추가는
-- upsert(row, { onConflict: 'id', ignoreDuplicates: true }) = ON CONFLICT DO NOTHING으로 하고,
-- 이를 통과시키려고 id/family_id에 UPDATE를 열지 않는다.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

select is(
  (select coalesce(array_agg(table_name::text order by table_name), '{}')
     from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'UPDATE'),
  '{}'::text[],
  'no public table grants table-wide UPDATE to authenticated — new table? revoke update, then grant update (allowed cols) only');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$insert into items (id, list_id, family_id, name)
    values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x')
    on conflict (id) do update set id = excluded.id, list_id = excluded.list_id,
      family_id = excluded.family_id, name = excluded.name$$,
  '42501', 'permission denied for table items',
  'merge upsert on items is denied by column grants — client inserts must use ignoreDuplicates (ON CONFLICT DO NOTHING)');

select * from finish();
rollback;
