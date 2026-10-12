-- 0001_identity_tenancy.sql — Week 2: identity, organizations, members, invites, audit.
--
-- Plan §7/§8 + AGENTS.md rule 7: every table ships WITH its grants and RLS
-- policies in this same migration. Forward-only; never edit after applying.
--
-- Design notes (deliberate decisions):
-- * Authorization helpers live in the non-exposed `private` schema as
--   SECURITY DEFINER functions with `search_path = ''` and fully qualified
--   names (plan §7 RLS pattern). DEFINER (table owner) bypasses RLS, which is
--   what prevents infinite recursion in policies on `organization_members`.
-- * Roles are rows in `organization_members`, never JWT claims or user
--   metadata (plan §7 "Role storage").
-- * Org + owner membership + default trust center + audit event are created
--   atomically by `create_organization_with_owner` — a failure can never leave
--   an ownerless organization (plan §7, journey J1).
-- * `trust_centers` is created minimal (W2): it exists so onboarding's atomic
--   contract can create the default row (J1 postcondition). Public/anonymous
--   policies and branding fields land in Week 7.
-- * `audit_events` lives here (plan groups it under billing/ops) because W2
--   member/role/invite actions must already write audit events.
-- * Final-owner protection is a BEFORE trigger: it also fires during FK
--   cascade deletes, so it explicitly allows deletes when the parent org row
--   is already gone (org deletion by its owner must not be blocked).
-- * Invitations store only a SHA-256 hex hash of the raw token (plan §7).
-- * All rejections use stable uppercase error codes as the exception MESSAGE
--   (e.g. 'INVITE_INVALID'). They are constant strings — no data, no SQL —
--   and the app maps them to safe user-facing copy (plan §16 log hygiene).

-- ---------------------------------------------------------------------------
-- Schemas, enums
-- ---------------------------------------------------------------------------

create schema if not exists private;

-- Postgres grants USAGE to PUBLIC on newly created schemas by default; the
-- private schema must not be reachable by API roles (plan §7).
revoke all on schema private from public, anon, authenticated;

create type public.app_role as enum ('owner', 'admin', 'reviewer', 'viewer');
create type public.organization_status as enum ('active', 'deactivated');

create table private.reserved_slugs (
  slug text primary key,
  reason text not null
);

-- Route + product-reserved slugs (journey J1 open question, decided W2:
-- slug rules are 3–40 chars, [a-z0-9-], no leading/trailing hyphen — enforced
-- by organizations_slug_check — plus this reserved list, checked in
-- create_organization_with_owner and mirrored client-side for fast feedback).
insert into private.reserved_slugs (slug, reason)
values
  ('app', 'route: authenticated app root'),
  ('api', 'route: api handlers'),
  ('auth', 'route: auth callbacks'),
  ('login', 'route: auth'),
  ('logout', 'route: auth'),
  ('signin', 'route: auth alias'),
  ('signup', 'route: auth'),
  ('signout', 'route: auth alias'),
  ('callback', 'route: auth callback'),
  ('onboarding', 'route: onboarding'),
  ('forgot-password', 'route: auth'),
  ('reset-password', 'route: auth'),
  ('admin', 'reserved (plan J1)'),
  ('trust', 'reserved (plan J1)'),
  ('demo', 'reserved (plan J1; public demo workspace)'),
  ('northstar-cloud', 'reserved (plan J1; seeded demo org)'),
  ('settings', 'app section'),
  ('members', 'app section'),
  ('billing', 'app section'),
  ('knowledge', 'app section'),
  ('documents', 'app section'),
  ('questionnaires', 'app section'),
  ('answers', 'app section'),
  ('trust-center', 'app section'),
  ('access-requests', 'app section'),
  ('notifications', 'app section'),
  ('platform', 'platform administration'),
  ('new', 'generic create route'),
  ('create', 'generic create route'),
  ('invite', 'generic invite route'),
  ('invites', 'generic invite route'),
  ('www', 'web convention');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '' check (char_length(full_name) <= 80),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  slug text not null,
  logo_url text,
  status public.organization_status not null default 'active',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_check check (
    char_length(slug) between 3 and 40
    and slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])$'
  )
);

create unique index organizations_slug_lower_key on public.organizations (lower(slug));

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_id_idx on public.organization_members (user_id);

create table public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- nullable: the inviter's account may later be deleted without invalidating
  -- a pending invite (acceptance never depends on the inviter existing).
  invited_by uuid references auth.users (id) on delete set null,
  email text not null,
  role public.app_role not null,
  -- sha256 hex of the raw token; the raw token itself is never stored.
  token_hash text not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_invites_email_check check (email ~* '^.+@.+\..+$' and char_length(email) <= 254),
  -- Invites never grant ownership: owners arise only from
  -- create_organization_with_owner (plan §7: admin cannot invite an owner).
  constraint organization_invites_role_allowed_check check (role in ('admin', 'reviewer', 'viewer')),
  constraint organization_invites_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint organization_invites_expiry_check check (expires_at > created_at)
);

create unique index organization_invites_token_hash_key on public.organization_invites (token_hash);
create index organization_invites_organization_id_idx on public.organization_invites (organization_id);
-- At most one pending invitation per email per organization.
create unique index organization_invites_one_pending_per_email_key
  on public.organization_invites (organization_id, lower(email))
  where accepted_at is null and revoked_at is null;

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 1 and 100),
  entity_type text not null check (char_length(entity_type) between 1 and 60),
  entity_id uuid,
  -- Safe metadata only — never document contents, prompts, answers, or
  -- secrets (plan §8/§16; enforced in application code, logged in
  -- memory/security-invariants).
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_organization_created_idx on public.audit_events (organization_id, created_at desc);

-- Minimal Week 2 shape: exists so onboarding's single atomic RPC can create
-- the default trust center (J1 postcondition). Branding/sections/public
-- access arrive in Week 7.
create table public.trust_centers (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  slug text not null,
  published boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trust_centers_slug_check check (
    char_length(slug) between 3 and 40
    and slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])$'
  )
);

create unique index trust_centers_slug_key on public.trust_centers (slug);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
volatile
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.organization_members
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.organization_invites
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.trust_centers
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER, search_path locked — plan §7)
-- ---------------------------------------------------------------------------

create or replace function private.is_org_member(p_organization_id uuid, p_roles public.app_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and (p_roles is null or m.role = any (p_roles))
  );
$$;

create or replace function private.current_org_role(p_organization_id uuid)
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.organization_members m
  where m.organization_id = p_organization_id
    and m.user_id = auth.uid()
  limit 1;
$$;

-- True when the caller shares at least one organization with p_user_id.
create or replace function private.shares_organization(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_user_id
  );
$$;

-- ---------------------------------------------------------------------------
-- Profile lifecycle (auth.users → profiles)
-- ---------------------------------------------------------------------------

create or replace function private.handle_new_user()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.sync_profile_email()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
    set email = coalesce(new.email, ''), updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function private.sync_profile_email();

-- Backfill profiles for any users that existed before this migration.
insert into public.profiles (id, email, full_name)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Final-owner protection (plan §7 "Prevent removal of the final owner")
-- ---------------------------------------------------------------------------

create or replace function private.protect_final_owner()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- Organization deletion cascades here AFTER the parent row is gone; that
  -- cascade must be allowed to proceed (the owner may delete their org).
  if tg_op = 'DELETE' and not exists (
    select 1 from public.organizations o where o.id = old.organization_id
  ) then
    return old;
  end if;

  if (tg_op = 'DELETE' and old.role = 'owner')
     or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    if not exists (
      select 1
      from public.organization_members m
      where m.organization_id = old.organization_id
        and m.role = 'owner'
        and m.user_id <> old.user_id
    ) then
      raise exception 'FINAL_OWNER_PROTECTED';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger protect_final_owner
  before delete or update of role on public.organization_members
  for each row execute function private.protect_final_owner();

-- ---------------------------------------------------------------------------
-- Atomic organization creation (plan §7, journey J1 step 5)
-- ---------------------------------------------------------------------------

create or replace function public.create_organization_with_owner(p_name text, p_slug text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_slug text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Only verified users create workspaces (journey J1: verify → onboarding).
  if not exists (
    select 1 from auth.users
    where id = v_user_id and email_confirmed_at is not null
  ) then
    raise exception 'EMAIL_NOT_VERIFIED';
  end if;

  v_slug := lower(btrim(coalesce(p_slug, '')));
  if v_slug = '' or p_name is null or btrim(p_name) = '' then
    raise exception 'ORG_INPUT_INVALID';
  end if;

  if exists (select 1 from private.reserved_slugs where slug = v_slug) then
    raise exception 'SLUG_RESERVED';
  end if;

  -- Format/length backstops live in organizations_slug_check/name_check;
  -- slug or trust-center-slug collisions raise SLUG_TAKEN via the
  -- unique_violation handler below. The whole block is one transaction:
  -- any failure leaves no organization, no membership, no trust center.
  insert into public.organizations (name, slug)
  values (btrim(p_name), v_slug)
  returning id into v_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org_id, v_user_id, 'owner');

  insert into public.trust_centers (organization_id, slug)
  values (v_org_id, v_slug);

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id)
  values (v_org_id, v_user_id, 'organization.created', 'organization', v_org_id);

  return v_org_id;
exception
  when unique_violation then
    raise exception 'SLUG_TAKEN';
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitation acceptance (plan §7 invitation flow, journey J2)
-- ---------------------------------------------------------------------------

create or replace function public.accept_organization_invite(p_raw_token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invite public.organization_invites%rowtype;
  v_org_status public.organization_status;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_raw_token is null or char_length(btrim(p_raw_token)) < 16 or char_length(btrim(p_raw_token)) > 256 then
    raise exception 'INVITE_INVALID';
  end if;

  select email into v_user_email
  from auth.users
  where id = v_user_id
    and email_confirmed_at is not null;

  -- From here on every failure raises the SAME code: never reveal whether a
  -- token exists, which check failed, or whom an invite was sent to.
  if v_user_email is null then
    raise exception 'INVITE_INVALID';
  end if;

  select * into v_invite
  from public.organization_invites
  where token_hash = encode(sha256(convert_to(btrim(p_raw_token), 'utf8')), 'hex');

  if not found then
    raise exception 'INVITE_INVALID';
  end if;

  if v_invite.accepted_at is not null
     or v_invite.revoked_at is not null
     or v_invite.expires_at <= now()
     or lower(v_invite.email) <> lower(v_user_email) then
    raise exception 'INVITE_INVALID';
  end if;

  select status into v_org_status
  from public.organizations
  where id = v_invite.organization_id;

  if v_org_status is distinct from 'active' then
    raise exception 'INVITE_INVALID';
  end if;

  -- Claim then insert inside ONE transaction: a duplicate-member violation
  -- escapes this function, so the claim rolls back too (reused token stays
  -- usable-by-no-one rather than consumed).
  update public.organization_invites
  set accepted_at = now(), updated_at = now()
  where id = v_invite.id;

  begin
    insert into public.organization_members (organization_id, user_id, role)
    values (v_invite.organization_id, v_user_id, v_invite.role);
  exception
    when unique_violation then
      raise exception 'INVITE_INVALID';
  end;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_invite.organization_id,
    v_user_id,
    'member.invitation_accepted',
    'organization_member',
    v_user_id,
    jsonb_build_object('role', v_invite.role::text)
  );

  return v_invite.organization_id;
end;
$$;

-- Invite preview (journey J2 step 3): the invitee must be signed in AS the
-- invited email AND hold the raw token. Empty result = not viewable; the
-- caller cannot distinguish the reason.
create or replace function public.preview_organization_invite(p_raw_token text)
returns table (organization_name text, inviter_name text, invited_role public.app_role, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.name,
    p.full_name,
    i.role,
    i.expires_at
  from public.organization_invites i
  join public.organizations o on o.id = i.organization_id
  left join public.profiles p on p.id = i.invited_by
  where i.token_hash = encode(sha256(convert_to(btrim(p_raw_token), 'utf8')), 'hex')
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and o.status = 'active'
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id = i.organization_id
        and m.user_id = auth.uid()
    )
    and exists (
      select 1
      from auth.users u
      where u.id = auth.uid()
        and u.email_confirmed_at is not null
        and lower(u.email) = lower(i.email)
    );
$$;

-- Revoke a pending invitation (PRD §7.6 open question "decide by W2":
-- revocation UI is part of member management, owner/admin only).
-- Idempotent: revoking an already-revoked/accepted invite is a silent no-op.
create or replace function public.revoke_organization_invite(p_organization_id uuid, p_invite_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not private.is_org_member(p_organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  update public.organization_invites
  set revoked_at = now(), updated_at = now()
  where id = p_invite_id
    and organization_id = p_organization_id
    and accepted_at is null
    and revoked_at is null;

  if found then
    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id)
    values (p_organization_id, v_actor, 'member.invitation_revoked', 'organization_invite', p_invite_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock down function privileges (functions are EXECUTE-to-PUBLIC by default)
-- ---------------------------------------------------------------------------

revoke all on function public.create_organization_with_owner(text, text) from public, anon;
revoke all on function public.accept_organization_invite(text) from public, anon;
revoke all on function public.preview_organization_invite(text) from public, anon;
revoke all on function public.revoke_organization_invite(uuid, uuid) from public, anon;
grant execute on function public.create_organization_with_owner(text, text) to authenticated;
grant execute on function public.accept_organization_invite(text) to authenticated;
grant execute on function public.preview_organization_invite(text) to authenticated;
grant execute on function public.revoke_organization_invite(uuid, uuid) to authenticated;

revoke all on function private.is_org_member(uuid, public.app_role[]) from public, anon;
revoke all on function private.current_org_role(uuid) from public, anon;
revoke all on function private.shares_organization(uuid) from public, anon;
grant execute on function private.is_org_member(uuid, public.app_role[]) to authenticated;
grant execute on function private.current_org_role(uuid) to authenticated;
grant execute on function private.shares_organization(uuid) to authenticated;

revoke all on all tables in schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS + explicit grants (plan §7: revoke first, then grant per operation)
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke create on schema public from public;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invites enable row level security;
alter table public.audit_events enable row level security;
alter table public.trust_centers enable row level security;

-- profiles ---------------------------------------------------------------

grant select on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

create policy "profiles_select_self" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles_select_org_peers" on public.profiles
  for select to authenticated
  using (private.shares_organization(id));

create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- organizations ----------------------------------------------------------

grant select, delete on public.organizations to authenticated;
grant update (name, logo_url, settings) on public.organizations to authenticated;

create policy "organizations_select_member" on public.organizations
  for select to authenticated
  using (private.is_org_member(id));

create policy "organizations_update_admin" on public.organizations
  for update to authenticated
  using (private.is_org_member(id, array['owner', 'admin']::public.app_role[]))
  with check (private.is_org_member(id, array['owner', 'admin']::public.app_role[]));

create policy "organizations_delete_owner" on public.organizations
  for delete to authenticated
  using (private.is_org_member(id, array['owner']::public.app_role[]));

-- organization_members ---------------------------------------------------

grant select, delete on public.organization_members to authenticated;
grant update (role) on public.organization_members to authenticated;

create policy "organization_members_select_member" on public.organization_members
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy "organization_members_update_manager" on public.organization_members
  for update to authenticated
  using (
    private.is_org_member(organization_id, array['owner']::public.app_role[])
    or (
      private.is_org_member(organization_id, array['admin']::public.app_role[])
      and role <> 'owner'
      and user_id <> (select auth.uid())
    )
  )
  with check (
    -- Owners may set any role (including a second owner); admins may never
    -- create an owner or change their own role (plan §7).
    private.is_org_member(organization_id, array['owner']::public.app_role[])
    or (
      private.is_org_member(organization_id, array['admin']::public.app_role[])
      and role in ('admin', 'reviewer', 'viewer')
      and user_id <> (select auth.uid())
    )
  );

create policy "organization_members_delete_manager" on public.organization_members
  for delete to authenticated
  using (
    private.is_org_member(organization_id, array['owner']::public.app_role[])
    or (
      private.is_org_member(organization_id, array['admin']::public.app_role[])
      and role <> 'owner'
      and user_id <> (select auth.uid())
    )
  );

-- organization_invites ---------------------------------------------------

grant select, insert on public.organization_invites to authenticated;

create policy "organization_invites_select_manager" on public.organization_invites
  for select to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "organization_invites_insert_manager" on public.organization_invites
  for insert to authenticated
  with check (
    private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[])
    and invited_by = (select auth.uid())
    and role in ('admin', 'reviewer', 'viewer')
  );

-- audit_events -----------------------------------------------------------

grant select, insert on public.audit_events to authenticated;

create policy "audit_events_select_member" on public.audit_events
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy "audit_events_insert_manager" on public.audit_events
  for insert to authenticated
  with check (
    private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[])
    and actor_id = (select auth.uid())
  );

-- trust_centers (member-only in W2; public policies land in Week 7) ------

grant select on public.trust_centers to authenticated;

create policy "trust_centers_select_member" on public.trust_centers
  for select to authenticated
  using (private.is_org_member(organization_id));
