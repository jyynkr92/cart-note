-- Cart Note 스키마와 무결성 제약 (RLS는 0002, RPC는 0003 이후)

create type public.list_kind as enum ('inbox', 'store', 'online');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  invite_code text not null unique check (invite_code ~ '^[0-9]{6}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.family_members (
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);
create index family_members_user_id_idx on public.family_members (user_id);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  kind public.list_kind not null,
  sort_order double precision not null default 0,
  created_at timestamptz not null default now(),
  unique (id, family_id)
);
create index lists_family_id_idx on public.lists (family_id);
create unique index lists_one_inbox_per_family on public.lists (family_id) where kind = 'inbox';

create table public.list_locations (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null,
  family_id uuid not null,
  place_name text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  kakao_place_id text,
  radius_m int not null default 300,
  foreign key (list_id, family_id) references public.lists (id, family_id) on delete cascade
);
create index list_locations_list_id_idx on public.list_locations (list_id);
create index list_locations_family_id_idx on public.list_locations (family_id);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null,
  family_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  note text,
  is_done boolean not null default false,
  done_at timestamptz,
  sort_order double precision not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (list_id, family_id) references public.lists (id, family_id) on delete cascade
);
create index items_list_id_idx on public.items (list_id);
create index items_family_id_idx on public.items (family_id);

-- inbox 목록은 삭제 불가. 부모 family가 이미 삭제 중(cascade)이면 허용한다.
create function public.prevent_inbox_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.kind = 'inbox'
     and exists (select 1 from public.families where id = old.family_id) then
    raise exception 'inbox list cannot be deleted';
  end if;
  return old;
end;
$$;

create trigger prevent_inbox_delete
  before delete on public.lists
  for each row execute function public.prevent_inbox_delete();

-- list_locations는 store 목록에만 허용
create function public.ensure_store_list() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.lists where id = new.list_id and kind = 'store'
  ) then
    raise exception 'locations only allowed on store lists';
  end if;
  return new;
end;
$$;

create trigger ensure_store_list
  before insert or update of list_id on public.list_locations
  for each row execute function public.ensure_store_list();

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();
