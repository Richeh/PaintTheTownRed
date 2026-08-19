-- Town Red
-- Initial collaborative schema

create extension if not exists pgcrypto;

create schema if not exists private;

-- Shared maps
create table public.maps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Membership. Owners are implicit and do not need a row here.
create table public.map_members (
  map_id uuid not null
    references public.maps(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  role text not null
    check (role in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (map_id, user_id)
);

-- Geographic paint strokes.
-- sequence provides one deterministic drawing order across clients.
create table public.strokes (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  map_id uuid not null
    references public.maps(id) on delete cascade,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  mode text not null
    check (mode in ('red', 'blue', 'erase')),
  brush_metres double precision not null
    check (brush_metres > 0),
  opacity real not null default 0.20
    check (opacity >= 0 and opacity <= 1),
  points jsonb not null,
  created_at timestamptz not null default now(),
  constraint strokes_points_is_array
    check (jsonb_typeof(points) = 'array')
);

create index strokes_map_sequence_idx
  on public.strokes(map_id, sequence);

create index map_members_user_idx
  on public.map_members(user_id);

-- Security helper functions
create or replace function private.is_map_owner(p_map_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.maps m
    where m.id = p_map_id
      and m.owner_id = (select auth.uid())
  );
$$;

create or replace function private.can_view_map(p_map_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.maps m
      where m.id = p_map_id
        and m.owner_id = (select auth.uid())
    )
    or
    exists (
      select 1
      from public.map_members mm
      where mm.map_id = p_map_id
        and mm.user_id = (select auth.uid())
    );
$$;

create or replace function private.can_edit_map(p_map_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.maps m
      where m.id = p_map_id
        and m.owner_id = (select auth.uid())
    )
    or
    exists (
      select 1
      from public.map_members mm
      where mm.map_id = p_map_id
        and mm.user_id = (select auth.uid())
        and mm.role = 'editor'
    );
$$;

revoke all on function private.is_map_owner(uuid) from public;
revoke all on function private.can_view_map(uuid) from public;
revoke all on function private.can_edit_map(uuid) from public;

grant execute on function private.is_map_owner(uuid) to authenticated;
grant execute on function private.can_view_map(uuid) to authenticated;
grant execute on function private.can_edit_map(uuid) to authenticated;

-- RLS
alter table public.maps enable row level security;
alter table public.map_members enable row level security;
alter table public.strokes enable row level security;

-- Maps
-- Owner access is checked directly here so INSERT ... RETURNING / .select()
-- can return a newly inserted owner row without relying on a helper lookup.
create policy maps_select
on public.maps
for select
to authenticated
using (
  owner_id = (select auth.uid())
  or private.can_view_map(id)
);

create policy maps_insert
on public.maps
for insert
to authenticated
with check (
  owner_id = (select auth.uid())
);

create policy maps_update
on public.maps
for update
to authenticated
using (
  owner_id = (select auth.uid())
)
with check (
  owner_id = (select auth.uid())
);

create policy maps_delete
on public.maps
for delete
to authenticated
using (
  owner_id = (select auth.uid())
);

-- Members
create policy members_select
on public.map_members
for select
to authenticated
using (
  private.can_view_map(map_id)
);

create policy members_insert
on public.map_members
for insert
to authenticated
with check (
  private.is_map_owner(map_id)
);

create policy members_update
on public.map_members
for update
to authenticated
using (
  private.is_map_owner(map_id)
)
with check (
  private.is_map_owner(map_id)
);

create policy members_delete
on public.map_members
for delete
to authenticated
using (
  private.is_map_owner(map_id)
);

-- Strokes
create policy strokes_select
on public.strokes
for select
to authenticated
using (
  private.can_view_map(map_id)
);

create policy strokes_insert
on public.strokes
for insert
to authenticated
with check (
  private.can_edit_map(map_id)
  and created_by = (select auth.uid())
);

-- Editors may delete their own strokes; owners may delete any stroke.
create policy strokes_delete
on public.strokes
for delete
to authenticated
using (
  created_by = (select auth.uid())
  or private.is_map_owner(map_id)
);

-- No UPDATE policy intentionally: strokes are immutable.

-- Data API privileges. RLS still controls individual rows.
revoke all on public.maps from anon;
revoke all on public.map_members from anon;
revoke all on public.strokes from anon;

grant select, insert, update, delete
  on public.maps
  to authenticated;

grant select, insert, update, delete
  on public.map_members
  to authenticated;

grant select, insert, delete
  on public.strokes
  to authenticated;

-- Realtime for collaborative stroke insertion.
-- Supabase creates this publication on hosted projects.
alter publication supabase_realtime
  add table public.strokes;
