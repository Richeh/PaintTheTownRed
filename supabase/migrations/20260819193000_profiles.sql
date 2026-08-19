-- Town Red
-- Friendly user profiles for anonymous and persistent identities.

create table public.profiles (
  user_id uuid primary key
    references auth.users(id) on delete cascade,
  display_name text not null
    check (char_length(trim(display_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- True when the current authenticated user and p_user_id can both access at
-- least one Town Red map. This keeps display names scoped to collaborators
-- rather than exposing every profile to every authenticated user.
create or replace function private.shares_map_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_user_id = (select auth.uid())
    or exists (
      select 1
      from public.maps m
      where m.owner_id = p_user_id
        and private.can_view_map(m.id)
    )
    or exists (
      select 1
      from public.map_members mm
      where mm.user_id = p_user_id
        and private.can_view_map(mm.map_id)
    );
$$;

revoke all on function private.shares_map_with(uuid) from public;
grant execute on function private.shares_map_with(uuid) to authenticated;

create or replace function private.set_profiles_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_profiles_updated_at() from public;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function private.set_profiles_updated_at();

alter table public.profiles enable row level security;

create policy profiles_select
on public.profiles
for select
to authenticated
using (
  private.shares_map_with(user_id)
);

create policy profiles_insert
on public.profiles
for insert
to authenticated
with check (
  user_id = (select auth.uid())
);

create policy profiles_update
on public.profiles
for update
to authenticated
using (
  user_id = (select auth.uid())
)
with check (
  user_id = (select auth.uid())
);

-- Profiles are retained for the lifetime of the auth identity and disappear
-- automatically when auth.users is deleted. No client-side DELETE policy.

revoke all on public.profiles from anon;
revoke all on public.profiles from authenticated;
grant select, insert, update on public.profiles to authenticated;
