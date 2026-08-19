-- Town Red
-- Anonymous invite-based collaboration

create table public.map_invites (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null
    references public.maps(id) on delete cascade,
  token_hash text not null unique,
  role text not null
    check (role in ('editor', 'viewer')),
  max_uses integer
    check (max_uses is null or max_uses > 0),
  use_count integer not null default 0
    check (use_count >= 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index map_invites_map_idx
  on public.map_invites(map_id);

alter table public.map_invites enable row level security;

-- Owners may inspect and revoke their own map invites.
create policy invites_select
on public.map_invites
for select
to authenticated
using (
  private.is_map_owner(map_id)
);

create policy invites_update
on public.map_invites
for update
to authenticated
using (
  private.is_map_owner(map_id)
)
with check (
  private.is_map_owner(map_id)
);

create policy invites_delete
on public.map_invites
for delete
to authenticated
using (
  private.is_map_owner(map_id)
);

-- Direct INSERT is intentionally withheld. Invite creation goes through the
-- security-definer RPC below so the plaintext token never needs to be stored.
revoke all on public.map_invites from anon;
revoke all on public.map_invites from authenticated;
grant select, update, delete on public.map_invites to authenticated;

-- Create an invite and return its plaintext token once.
create or replace function public.create_map_invite(
  p_map_id uuid,
  p_role text default 'editor',
  p_max_uses integer default 1,
  p_expires_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_map_owner(p_map_id) then
    raise exception 'Only the map owner may create invites';
  end if;

  if p_role not in ('editor', 'viewer') then
    raise exception 'Invalid invite role';
  end if;

  if p_max_uses is not null and p_max_uses < 1 then
    raise exception 'max_uses must be at least 1 or null';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Invite expiry must be in the future';
  end if;

  -- 256 bits of random material, URL-safe enough for copy/paste/link encoding.
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.map_invites (
    map_id,
    token_hash,
    role,
    max_uses,
    expires_at,
    created_by
  ) values (
    p_map_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_role,
    p_max_uses,
    p_expires_at,
    (select auth.uid())
  );

  return v_token;
end;
$$;

-- Redeem an invite as the current authenticated (including anonymous) user.
-- The invite row is locked while being consumed so max_uses is race-safe.
create or replace function public.join_map_with_invite(p_token text)
returns table (
  map_id uuid,
  role text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.map_invites%rowtype;
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select i.*
    into v_invite
  from public.map_invites i
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if not found then
    raise exception 'Invalid invite';
  end if;

  if v_invite.revoked_at is not null then
    raise exception 'Invite has been revoked';
  end if;

  if v_invite.expires_at is not null
     and v_invite.expires_at <= now() then
    raise exception 'Invite has expired';
  end if;

  if v_invite.max_uses is not null
     and v_invite.use_count >= v_invite.max_uses then
    raise exception 'Invite has no remaining uses';
  end if;

  -- Owners already have full access; don't create a redundant membership.
  if not private.is_map_owner(v_invite.map_id) then
    insert into public.map_members (map_id, user_id, role)
    values (v_invite.map_id, v_user_id, v_invite.role)
    on conflict (map_id, user_id)
    do update set role = excluded.role;
  end if;

  update public.map_invites i
  set use_count = i.use_count + 1
  where i.id = v_invite.id;

  return query
  select v_invite.map_id, v_invite.role;
end;
$$;

create or replace function public.revoke_map_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map_id uuid;
begin
  select i.map_id
    into v_map_id
  from public.map_invites i
  where i.id = p_invite_id;

  if v_map_id is null then
    raise exception 'Invite not found';
  end if;

  if not private.is_map_owner(v_map_id) then
    raise exception 'Only the map owner may revoke invites';
  end if;

  update public.map_invites
  set revoked_at = now()
  where id = p_invite_id;
end;
$$;

create or replace function public.remove_map_member(
  p_map_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_map_owner(p_map_id) then
    raise exception 'Only the map owner may remove members';
  end if;

  delete from public.map_members
  where map_id = p_map_id
    and user_id = p_user_id;
end;
$$;

revoke all on function public.create_map_invite(uuid, text, integer, timestamptz) from public;
revoke all on function public.join_map_with_invite(text) from public;
revoke all on function public.revoke_map_invite(uuid) from public;
revoke all on function public.remove_map_member(uuid, uuid) from public;

grant execute on function public.create_map_invite(uuid, text, integer, timestamptz)
  to authenticated;
grant execute on function public.join_map_with_invite(text)
  to authenticated;
grant execute on function public.revoke_map_invite(uuid)
  to authenticated;
grant execute on function public.remove_map_member(uuid, uuid)
  to authenticated;
