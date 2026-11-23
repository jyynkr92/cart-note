-- /review R4, A10: 참여 후 "빈 그룹 삭제" 프롬프트용 판정.
-- 이전에는 멤버 1명 + 항목 0개만 봤기 때문에, 목록/지점을 만들어 둔 그룹도 비어 있다고 물었다.
-- 빈 그룹 = 멤버가 호출자 1명뿐, 항목 0개, inbox 외 목록 없음, 지점 없음.
create function public.family_is_empty(p_family_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.family_members where family_id = p_family_id and user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return (select count(*) from public.family_members where family_id = p_family_id) = 1
    and not exists (select 1 from public.items where family_id = p_family_id)
    and not exists (select 1 from public.lists where family_id = p_family_id and kind <> 'inbox')
    and not exists (select 1 from public.list_locations where family_id = p_family_id);
end;
$$;

revoke execute on function public.family_is_empty(uuid) from public, anon;
grant execute on function public.family_is_empty(uuid) to authenticated;
