-- Town Red
-- Shared points / markers

create table public.markers (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null
    references public.maps(id) on delete cascade,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  kind text not null default 'point'
    check (kind in ('house', 'viewed', 'poi', 'note', 'point')),
  label text not null
    check (char_length(btrim(label)) between 1 and 160),
  longitude double precision not null
    check (longitude >= -180 and longitude <= 180),
  latitude double precision not null
    check (latitude >= -90 and latitude <= 90),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index markers_map_idx
  on public.markers(map_id, created_at);

alter table public.markers enable row level security;

create policy markers_select
on public.markers
for select
to authenticated
using (
  private.can_view_map(map_id)
);

create policy markers_insert
on public.markers
for insert
to authenticated
with check (
  private.can_edit_map(map_id)
  and created_by = (select auth.uid())
);

create policy markers_update
on public.markers
for update
to authenticated
using (
  created_by = (select auth.uid())
  or private.is_map_owner(map_id)
)
with check (
  private.can_edit_map(map_id)
  and (
    created_by = (select auth.uid())
    or private.is_map_owner(map_id)
  )
);

create policy markers_delete
on public.markers
for delete
to authenticated
using (
  created_by = (select auth.uid())
  or private.is_map_owner(map_id)
);

revoke all on public.markers from anon;
grant select, insert, update, delete on public.markers to authenticated;

alter publication supabase_realtime
  add table public.markers;
