-- Town Red
-- Resolve the current user's role on a map without exposing map_members directly.

create or replace function public.get_my_map_role(p_map_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.maps m
      where m.id = p_map_id
        and m.owner_id = (select auth.uid())
    ) then 'owner'
    else (
      select mm.role
      from public.map_members mm
      where mm.map_id = p_map_id
        and mm.user_id = (select auth.uid())
      limit 1
    )
  end;
$$;

revoke all on function public.get_my_map_role(uuid) from public;
grant execute on function public.get_my_map_role(uuid) to authenticated;
