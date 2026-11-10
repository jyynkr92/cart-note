-- Cart Note RLS 정책. families/family_members의 insert/delete는 RPC(0003) 전용.

create function public.is_member(fid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.family_members
    where family_id = fid and user_id = (select auth.uid())
  );
$$;
revoke execute on function public.is_member(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.lists enable row level security;
alter table public.list_locations enable row level security;
alter table public.items enable row level security;

-- anon은 어떤 테이블도 접근 불가
revoke all on public.profiles, public.families, public.family_members,
  public.lists, public.list_locations, public.items from anon;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.family_members mine
      join public.family_members theirs on theirs.family_id = mine.family_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.user_id
    )
  );
create policy profiles_insert on public.profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- families: select/update만 (insert/delete는 RPC)
create policy families_select on public.families for select to authenticated
  using (public.is_member(id));
create policy families_update on public.families for update to authenticated
  using (public.is_member(id))
  with check (public.is_member(id));

-- family_members: select만 (insert/delete는 RPC)
create policy family_members_select on public.family_members for select to authenticated
  using (public.is_member(family_id));

-- lists / list_locations / items: 멤버 CRUD
create policy lists_select on public.lists for select to authenticated
  using (public.is_member(family_id));
create policy lists_insert on public.lists for insert to authenticated
  with check (public.is_member(family_id));
create policy lists_update on public.lists for update to authenticated
  using (public.is_member(family_id)) with check (public.is_member(family_id));
create policy lists_delete on public.lists for delete to authenticated
  using (public.is_member(family_id));

create policy list_locations_select on public.list_locations for select to authenticated
  using (public.is_member(family_id));
create policy list_locations_insert on public.list_locations for insert to authenticated
  with check (public.is_member(family_id));
create policy list_locations_update on public.list_locations for update to authenticated
  using (public.is_member(family_id)) with check (public.is_member(family_id));
create policy list_locations_delete on public.list_locations for delete to authenticated
  using (public.is_member(family_id));

create policy items_select on public.items for select to authenticated
  using (public.is_member(family_id));
create policy items_insert on public.items for insert to authenticated
  with check (public.is_member(family_id));
create policy items_update on public.items for update to authenticated
  using (public.is_member(family_id)) with check (public.is_member(family_id));
create policy items_delete on public.items for delete to authenticated
  using (public.is_member(family_id));

-- Realtime
alter publication supabase_realtime add table public.items, public.lists, public.list_locations;
