-- Town Red
-- Stable pastel colours for collaborator layers and point markers.
--
-- Colours belong to profiles rather than individual markers so the same person
-- is visually recognisable across every shared map and on every device. The
-- palette is intentionally light enough for dark marker text to stay readable.

create or replace function private.profile_marker_colour(p_user_id uuid)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select (array[
    '#F7D6E0', -- blush pink
    '#FAD9C1', -- peach
    '#FBE7B2', -- soft amber
    '#E8EDB7', -- pale lime
    '#CFE8C8', -- mint
    '#C7E9E3', -- aqua
    '#CBE3F6', -- powder blue
    '#D8D5F2', -- lavender
    '#E7D1F2', -- lilac
    '#F2D2E6', -- rose
    '#D5E4D0', -- sage
    '#D9E1F2'  -- periwinkle
  ])[1 + (get_byte(decode(md5(p_user_id::text), 'hex'), 0) % 12)];
$$;

revoke all on function private.profile_marker_colour(uuid) from public;

alter table public.profiles
  add column marker_colour text;

update public.profiles
set marker_colour = private.profile_marker_colour(user_id)
where marker_colour is null;

alter table public.profiles
  alter column marker_colour set not null;

alter table public.profiles
  add constraint profiles_marker_colour_hex
  check (marker_colour ~ '^#[0-9A-Fa-f]{6}$');

-- Clients normally create profiles through the web app, but assigning the
-- colour in a trigger keeps the invariant true for any future client too.
create or replace function private.set_profile_marker_colour()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.marker_colour is null then
    new.marker_colour := private.profile_marker_colour(new.user_id);
  end if;
  return new;
end;
$$;

revoke all on function private.set_profile_marker_colour() from public;

create trigger profiles_set_marker_colour
before insert on public.profiles
for each row
execute function private.set_profile_marker_colour();
