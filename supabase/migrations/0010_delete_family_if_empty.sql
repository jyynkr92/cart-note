-- /review pass 2 B9: 참여 후 "빈 그룹 삭제"의 확인(family_is_empty)과 삭제(leave_family) 사이에
-- 다른 멤버가 참여하거나 항목/목록을 넣으면 그 데이터까지 지워질 수 있었다. 잠근 뒤 다시 확인하고 지운다.
create function public.delete_family_if_empty(p_family_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.family_members where family_id = p_family_id and user_id = v_uid) then
    raise exception 'not_member';
  end if;

  -- family 행 잠금: 동시 참여(family_members FK의 KEY SHARE)와 leave를 막는다.
  perform 1 from public.families where id = p_family_id for update;
  -- 목록 행 잠금: 동시 항목/지점 삽입(lists FK의 KEY SHARE)을 막는다.
  perform 1 from public.lists where family_id = p_family_id for update;

  -- 잠근 상태에서 다시 확인: 호출자 혼자이고 항목·추가 목록·지점이 없어야 한다.
  if (select count(*) from public.family_members where family_id = p_family_id) <> 1
     or not exists (select 1 from public.family_members where family_id = p_family_id and user_id = v_uid)
     or exists (select 1 from public.items where family_id = p_family_id)
     or exists (select 1 from public.lists where family_id = p_family_id and kind <> 'inbox')
     or exists (select 1 from public.list_locations where family_id = p_family_id) then
    return false;
  end if;

  delete from public.families where id = p_family_id;
  return true;
end;
$$;

revoke execute on function public.delete_family_if_empty(uuid) from public, anon;
grant execute on function public.delete_family_if_empty(uuid) to authenticated;
