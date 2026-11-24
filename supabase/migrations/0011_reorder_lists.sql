-- 목록 순서를 한 번에 저장한다. p_ids 순서대로 inbox가 아닌 목록에 1..k를 쓰고,
-- 빠진 목록은 기존 (sort_order, created_at) 순서를 지켜 뒤에 붙인다. inbox의 sort_order는 건드리지 않는다.
create function public.reorder_lists(p_family_id uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.family_members where family_id = p_family_id and user_id = v_uid) then
    raise exception 'not_member';
  end if;

  -- 동시 재정렬이 섞이지 않도록 이 그룹의 목록 행을 잠근다.
  perform 1 from public.lists where family_id = p_family_id order by id for update;

  with given as (
    -- 그룹에 있는 inbox가 아닌 목록만, 첫 등장 위치 기준(중복 id는 한 번만).
    select l.id, min(g.ord) as ord
    from unnest(coalesce(p_ids, array[]::uuid[])) with ordinality as g(id, ord)
    join public.lists l on l.id = g.id and l.family_id = p_family_id and l.kind <> 'inbox'
    group by l.id
  ),
  ranked as (
    select l.id,
      row_number() over (
        order by (g.id is null), g.ord, l.sort_order, l.created_at, l.id
      )::double precision as new_order
    from public.lists l
    left join given g on g.id = l.id
    where l.family_id = p_family_id and l.kind <> 'inbox'
  )
  update public.lists l set sort_order = r.new_order
  from ranked r
  where l.id = r.id and l.sort_order is distinct from r.new_order;
end;
$$;

revoke execute on function public.reorder_lists(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_lists(uuid, uuid[]) to authenticated;
