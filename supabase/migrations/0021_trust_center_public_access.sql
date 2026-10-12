-- 0021_trust_center_public_access.sql — Week 7: public Trust Center and
-- controlled document sharing (plan §W7, §7-§8, PRD §7.4).
--
-- AGENTS.md rule 7: every table below ships WITH its grants and RLS policies
-- (RLS enabled explicitly — the 0018 lesson, fixed in 0020, is baked in here).
-- Forward-only; never edit after applying.
--
-- Design notes (deliberate decisions):
-- * STATUS ENUM REPLACES `published` (D028): draft → preview → published.
--   `preview` is the internal-only editor preview; only `published` is
--   publicly readable. Publishing requires branding + clickwrap terms —
--   enforced in set_trust_center_status, not just the UI.
-- * PUBLIC READS GO THROUGH ONE RPC. Anonymous visitors never get table
--   SELECT on trust-center tables: get_trust_center_overview(slug) is a
--   SECURITY DEFINER function that hand-builds an allowlisted jsonb payload
--   (the plan-named `get_public_trust_center` shape). Unknown AND
--   unpublished slugs both return null — no existence leak (plan §W7 gate).
-- * CONTENT TABLES carry explicit public-visibility flags (`visible` /
--   `publicly_visible` / `publicly_requestable`). A flag is necessary but
--   not sufficient: every public/grantable document path additionally
--   requires documents.state = 'active' AND a `ready` version — draft,
--   archived, unprocessed, and failed documents can never render or be
--   granted (plan §W7 test list). "Replaced" is covered by archiving: an
--   archived document's grants stop working with a generic denial.
-- * ACCESS REQUESTS (PRD §7.4): submitted → pending_review → approved |
--   denied; expired terminal, flipped lazily by expire_overdue_trust_access()
--   (called at the top of every trust RPC — no cron on the free tier).
--   Email verification is a per-Trust-Center flag, default OFF (D029): the
--   verification token is a stateless HMAC minted by the app from
--   AUDIT_HASH_SALT; this DB only exposes the idempotent state flip.
-- * PROSPECT LINK TOKEN (D019 invite pattern): on approval the RPC mints a
--   32-byte hex token, stores ONLY its SHA-256 hash, and returns the raw
--   token exactly once. The prospect link is /trust/{slug}/access/{token};
--   every prospect RPC re-hashes and re-validates (state + expiry + org +
--   published center). Grants are per (request, document) rows with their
--   own expiry (1-30 days); a grant can never be replayed for another
--   document or organization because the document id is validated against
--   the grant row in the same query that authorizes it.
-- * CLICKWRAP: nda_acceptances records the terms_version AND the SHA-256 of
--   the EXACT terms_text displayed at submission time. The browser supplies
--   only a boolean acceptance — version/hash are read server-side from the
--   stored row, never trusted from input (plan §W7 "version/hash").
-- * RATE LIMITING: private.rate_limit_buckets + private.consume_rate_limit
--   (atomic upsert counter, window-resets) land here because the public
--   request form is the first anon-write surface (plan §8; W8 reuses it).
--   Per-center 20/hour, per-IP-hash 5/hour.
-- * NOTIFICATIONS: owners+admins get an in-app notification per submission
--   (the W6 insert_notification choke point); the notifications
--   entity_type check widens with 'access_request' + 'trust_center'.
-- * AUDIT: request submitted (actor null — anonymous), approved/denied,
--   grant revoked, trust-center status changes. Metadata carries ids/counts
--   only — never names, emails, or terms text (AGENTS rule 8).
-- * DOWNLOAD EVENTS are append-only, written solely by
--   trust_download_document after full validation; members read them.
-- * All rejections use stable uppercase error codes as the exception MESSAGE
--   (0001/0003/0010/0014/0018 convention) — mapped to safe copy in app.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.trust_center_status as enum ('draft', 'preview', 'published');

create type public.certification_status as enum ('active', 'expired', 'planned');

create type public.access_request_state as enum
  ('submitted', 'pending_review', 'approved', 'denied', 'expired');

create type public.access_grant_state as enum ('active', 'expired', 'revoked');

-- ---------------------------------------------------------------------------
-- trust_centers: W2 minimal shape grows up (published → status, D028)
-- ---------------------------------------------------------------------------

alter table public.trust_centers
  add column status public.trust_center_status not null default 'draft',
  add column display_name text
    check (display_name is null or char_length(btrim(display_name)) between 1 and 120),
  add column hero_title text
    check (hero_title is null or char_length(btrim(hero_title)) between 1 and 160),
  add column hero_subtitle text
    check (hero_subtitle is null or char_length(btrim(hero_subtitle)) between 1 and 240),
  add column overview text
    check (overview is null or char_length(btrim(overview)) between 1 and 4000),
  add column contact_email text
    check (
      contact_email is null
      or (char_length(contact_email) <= 254
          and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    ),
  add column logo_url text
    check (logo_url is null or (logo_url ~ '^https://[^[:space:]]+$' and char_length(logo_url) <= 500)),
  add column terms_version text not null default ''
    check (char_length(terms_version) <= 40),
  add column terms_text text not null default ''
    check (char_length(terms_text) <= 20000),
  add column require_email_verification boolean not null default false;

update public.trust_centers set status = 'published' where published;

alter table public.trust_centers drop column published;

grant select, update on public.trust_centers to authenticated;

alter table public.trust_centers enable row level security;

create policy "trust_centers_update_owner_admin" on public.trust_centers
  for update to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]))
  with check (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

-- ---------------------------------------------------------------------------
-- Public content tables (org-managed; visibility flags gate public reads)
-- ---------------------------------------------------------------------------

create table public.trust_center_faqs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  question text not null check (char_length(btrim(question)) between 1 and 300),
  answer text not null check (char_length(btrim(answer)) between 1 and 2000),
  -- Visible on the published page only when true (plan §W7 "public-visibility
  -- controls").
  visible boolean not null default true,
  position integer not null default 0 check (position between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trust_center_faqs_organization_idx
  on public.trust_center_faqs (organization_id, position, created_at);

create table public.certifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  status public.certification_status not null default 'active',
  issuer text check (issuer is null or char_length(btrim(issuer)) between 1 and 120),
  valid_from date,
  valid_until date
    check (valid_until is null or valid_from is null or valid_until >= valid_from),
  -- Demo tenant marks its fictional certs (plan §15 "certifications
  -- explicitly marked Demo").
  demo boolean not null default false,
  publicly_visible boolean not null default true,
  position integer not null default 0 check (position between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index certifications_organization_idx
  on public.certifications (organization_id, position, created_at);

create table public.subprocessors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company text not null check (char_length(btrim(company)) between 1 and 160),
  purpose text not null check (char_length(btrim(purpose)) between 1 and 300),
  data_category text not null check (char_length(btrim(data_category)) between 1 and 160),
  region text not null check (char_length(btrim(region)) between 1 and 120),
  publicly_visible boolean not null default true,
  position integer not null default 0 check (position between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subprocessors_organization_idx
  on public.subprocessors (organization_id, position, created_at);

-- Document cards: the requestable surface. A document appears publicly only
-- through a row here with publicly_requestable AND a live/ready document.
create table public.trust_center_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  publicly_requestable boolean not null default true,
  position integer not null default 0 check (position between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, document_id)
);

create index trust_center_documents_organization_idx
  on public.trust_center_documents (organization_id, position, created_at);
create index trust_center_documents_document_idx
  on public.trust_center_documents (document_id);

revoke all on public.trust_center_faqs, public.certifications,
  public.subprocessors, public.trust_center_documents
  from anon, authenticated;
grant select, insert, update, delete on public.trust_center_faqs,
  public.certifications, public.subprocessors, public.trust_center_documents
  to authenticated;

alter table public.trust_center_faqs enable row level security;
alter table public.certifications enable row level security;
alter table public.subprocessors enable row level security;
alter table public.trust_center_documents enable row level security;

create policy "trust_center_faqs_select_member" on public.trust_center_faqs
  for select to authenticated
  using (private.is_org_member(organization_id));
create policy "trust_center_faqs_write_owner_admin" on public.trust_center_faqs
  for all to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]))
  with check (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "certifications_select_member" on public.certifications
  for select to authenticated
  using (private.is_org_member(organization_id));
create policy "certifications_write_owner_admin" on public.certifications
  for all to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]))
  with check (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "subprocessors_select_member" on public.subprocessors
  for select to authenticated
  using (private.is_org_member(organization_id));
create policy "subprocessors_write_owner_admin" on public.subprocessors
  for all to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]))
  with check (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "trust_center_documents_select_member" on public.trust_center_documents
  for select to authenticated
  using (private.is_org_member(organization_id));
create policy "trust_center_documents_write_owner_admin" on public.trust_center_documents
  for all to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]))
  with check (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

create trigger set_updated_at before update on public.trust_center_faqs
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.certifications
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.subprocessors
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.trust_center_documents
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Access requests, grants, clickwrap records, download events
-- ---------------------------------------------------------------------------

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  prospect_name text not null check (char_length(btrim(prospect_name)) between 1 and 120),
  prospect_company text not null check (char_length(btrim(prospect_company)) between 1 and 160),
  prospect_email text not null
    check (
      char_length(prospect_email) <= 254
      and prospect_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ),
  state public.access_request_state not null default 'submitted',
  -- Validated against trust_center_documents at submit AND re-validated at
  -- approval; uuid[] cannot carry FKs.
  requested_document_ids uuid[] not null
    check (cardinality(requested_document_ids) between 1 and 20),
  -- SHA-256 hex of the raw prospect-link token; set on approval; NULL before.
  prospect_token_hash text
    check (prospect_token_hash is null or prospect_token_hash ~ '^[0-9a-f]{64}$'),
  -- Unresolved requests die after 30 days (plan §7.4 "request expiry").
  request_expires_at timestamptz not null,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  -- Salted hash + coarse summary, both optional (plan §15 IP hygiene).
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  ua_summary text check (char_length(coalesce(ua_summary, '')) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index access_requests_organization_created_idx
  on public.access_requests (organization_id, created_at desc);
create index access_requests_open_idx
  on public.access_requests (request_expires_at)
  where state in ('submitted', 'pending_review');
-- Token lookups: the login-speed path for every prospect RPC.
create unique index access_requests_token_key on public.access_requests (prospect_token_hash)
  where prospect_token_hash is not null;

create table public.document_access_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  access_request_id uuid not null references public.access_requests (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  state public.access_grant_state not null default 'active',
  expires_at timestamptz not null,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One grant per (request, document): re-approval extends, never duplicates.
  unique (access_request_id, document_id)
);

create index document_access_grants_organization_idx
  on public.document_access_grants (organization_id, created_at desc);
create index document_access_grants_request_idx
  on public.document_access_grants (access_request_id);
create index document_access_grants_expiry_idx
  on public.document_access_grants (expires_at) where state = 'active';

-- Clickwrap acceptance record (plan §W7 "terms version/hash and NDA
-- acceptance record"). version+hash are read from the STORED trust-center
-- terms — never accepted from the browser.
create table public.nda_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  access_request_id uuid not null references public.access_requests (id) on delete cascade,
  terms_version text not null check (char_length(btrim(terms_version)) between 1 and 40),
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default now(),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$')
);

create index nda_acceptances_request_idx on public.nda_acceptances (access_request_id);

-- Append-only download trail (J9 step 5). Written only by
-- trust_download_document; no update/delete grants exist for anyone.
create table public.download_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  access_request_id uuid not null references public.access_requests (id) on delete cascade,
  grant_id uuid not null references public.document_access_grants (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  document_version_id uuid not null references public.document_versions (id) on delete cascade,
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  ua_summary text check (char_length(coalesce(ua_summary, '')) <= 120),
  created_at timestamptz not null default now()
);

create index download_events_organization_created_idx
  on public.download_events (organization_id, created_at desc);
create index download_events_request_idx on public.download_events (access_request_id);

revoke all on public.access_requests, public.document_access_grants,
  public.nda_acceptances, public.download_events
  from anon, authenticated;
grant select on public.access_requests, public.document_access_grants,
  public.nda_acceptances, public.download_events
  to authenticated;

alter table public.access_requests enable row level security;
alter table public.document_access_grants enable row level security;
alter table public.nda_acceptances enable row level security;
alter table public.download_events enable row level security;

-- Reads are member-wide (the queue is internal); every write goes through
-- the SECURITY DEFINER RPCs — there are deliberately NO insert/update/delete
-- policies on these tables for any role.
create policy "access_requests_select_member" on public.access_requests
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy "document_access_grants_select_member" on public.document_access_grants
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy "nda_acceptances_select_member" on public.nda_acceptances
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy "download_events_select_member" on public.download_events
  for select to authenticated
  using (private.is_org_member(organization_id));

create trigger set_updated_at before update on public.access_requests
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.document_access_grants
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Atomic rate limiting (plan §8; first consumer: the public request form)
-- ---------------------------------------------------------------------------

create table private.rate_limit_buckets (
  bucket text primary key check (char_length(bucket) between 3 and 160),
  window_start timestamptz not null,
  hits integer not null default 0
);

-- Returns true when the action is allowed (this hit counted), false when the
-- limit is exhausted. Window resets on the first hit after expiry; the
-- upsert serializes concurrent callers on the row (atomic, plan §W8 same
-- primitive reused for demo + sensitive endpoints).
create or replace function private.consume_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_hits integer;
begin
  if p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'RATE_LIMIT_CONFIG_INVALID';
  end if;

  insert into private.rate_limit_buckets (bucket, window_start, hits)
  values (p_bucket, v_now, 1)
  on conflict (bucket) do update set
    window_start = case
      when private.rate_limit_buckets.window_start + make_interval(secs => p_window_seconds) <= v_now
      then v_now
      else private.rate_limit_buckets.window_start
    end,
    hits = case
      when private.rate_limit_buckets.window_start + make_interval(secs => p_window_seconds) <= v_now
      then 1
      else private.rate_limit_buckets.hits + 1
    end
  returning hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

revoke all on function private.consume_rate_limit(text, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Notifications: widen entity_type for the two W7 entities
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_entity_type_check;
alter table public.notifications add constraint notifications_entity_type_check
  check (entity_type in (
    'questionnaire', 'question', 'answer', 'comment', 'export',
    'access_request', 'trust_center'
  ));

-- ---------------------------------------------------------------------------
-- Shared private helpers
-- ---------------------------------------------------------------------------

-- A document is publicly requestable/grantable ONLY when it has a visible
-- trust-center card AND is active AND has a ready version. Every public and
-- grant path funnels through this one predicate (plan §W7 gate).
create or replace function private.trust_document_requestable(
  p_organization_id uuid,
  p_document_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trust_center_documents tcd
    join public.documents d on d.id = tcd.document_id
    where tcd.organization_id = p_organization_id
      and tcd.document_id = p_document_id
      and tcd.publicly_requestable
      and d.state = 'active'
      and exists (
        select 1 from public.document_versions dv
        where dv.document_id = d.id and dv.processing_state = 'ready'
      )
  );
$$;

revoke all on function private.trust_document_requestable(uuid, uuid) from public, anon, authenticated;

-- Latest ready version of a document (what a gated download always serves).
create or replace function private.latest_ready_document_version(
  p_document_id uuid
)
returns setof public.document_versions
language sql
stable
security definer
set search_path = ''
as $$
  select dv.*
  from public.document_versions dv
  where dv.document_id = p_document_id
    and dv.processing_state = 'ready'
  order by dv.version_number desc
  limit 1;
$$;

revoke all on function private.latest_ready_document_version(uuid) from public, anon, authenticated;

-- Lazy expiry sweep (no cron on the free tier): flips overdue open requests
-- and overdue active grants to 'expired'. Called at the top of every trust
-- RPC; plain UPDATEs are idempotent under concurrency.
create or replace function private.expire_overdue_trust_access()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.access_requests
  set state = 'expired'
  where state in ('submitted', 'pending_review')
    and request_expires_at <= now();

  update public.document_access_grants
  set state = 'expired'
  where state = 'active'
    and expires_at <= now();
$$;

revoke all on function private.expire_overdue_trust_access() from public, anon, authenticated;

-- Central prospect-link validation: returns the request row when the raw
-- token maps to an approved, unexpired request under a PUBLISHED center with
-- the given slug; raises the matching stable code otherwise. Token hashing
-- is deliberately identical to the invite pattern (0001).
create or replace function private.resolve_trust_access_request(
  p_slug text,
  p_raw_token text
)
returns public.access_requests
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_request public.access_requests;
  v_hash text := encode(sha256(convert_to(btrim(coalesce(p_raw_token, '')), 'utf8')), 'hex');
begin
  select ar.*
  into v_request
  from public.access_requests ar
  join public.trust_centers tc on tc.organization_id = ar.organization_id
  where ar.prospect_token_hash = v_hash
    and tc.slug = p_slug
    and tc.status = 'published'
  limit 1;

  if v_request.id is null then
    raise exception 'ACCESS_LINK_INVALID';
  end if;

  if v_request.state = 'expired' or v_request.request_expires_at <= now() then
    raise exception 'ACCESS_LINK_EXPIRED';
  end if;

  if v_request.state <> 'approved' then
    raise exception 'ACCESS_LINK_INVALID';
  end if;

  return v_request;
end;
$$;

revoke all on function private.resolve_trust_access_request(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: set_trust_center_status (owner/admin; publish is validated in DB)
-- ---------------------------------------------------------------------------

create or replace function public.set_trust_center_status(
  p_organization_id uuid,
  p_status public.trust_center_status
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old public.trust_center_status;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not private.is_org_member(p_organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_old from public.trust_centers
  where organization_id = p_organization_id;
  if v_old is null then
    raise exception 'TRUST_CENTER_NOT_FOUND';
  end if;

  -- Publishing demands a complete, honest public page: branding, contact,
  -- and clickwrap terms must exist (plan §W7; the UI mirrors this list).
  if p_status = 'published' then
    if not exists (
      select 1 from public.trust_centers tc
      where tc.organization_id = p_organization_id
        and btrim(coalesce(tc.display_name, '')) <> ''
        and btrim(coalesce(tc.hero_title, '')) <> ''
        and btrim(coalesce(tc.overview, '')) <> ''
        and btrim(coalesce(tc.contact_email, '')) <> ''
        and btrim(tc.terms_version) <> ''
        and btrim(tc.terms_text) <> ''
    ) then
      raise exception 'PUBLISH_REQUIREMENTS';
    end if;
  end if;

  update public.trust_centers
  set status = p_status
  where organization_id = p_organization_id;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_organization_id,
    v_actor,
    'trust_center.status_changed',
    'trust_center',
    p_organization_id,
    jsonb_build_object('from', v_old::text, 'to', p_status::text)
  );
end;
$$;

revoke all on function public.set_trust_center_status(uuid, public.trust_center_status) from public, anon, authenticated;
grant execute on function public.set_trust_center_status(uuid, public.trust_center_status) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: get_trust_center_overview — THE public read (allowlisted jsonb)
-- ---------------------------------------------------------------------------

-- Returns null for unknown AND unpublished slugs alike (no existence leak).
-- This is the only surface anonymous visitors have: no table grants, no
-- other RPC exposes trust-center content.
create or replace function public.get_trust_center_overview(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', tc.slug,
    'displayName', tc.display_name,
    'heroTitle', tc.hero_title,
    'heroSubtitle', tc.hero_subtitle,
    'overview', tc.overview,
    'contactEmail', tc.contact_email,
    'logoUrl', tc.logo_url,
    'faqs', coalesce((
      select jsonb_agg(
        jsonb_build_object('question', f.question, 'answer', f.answer)
        order by f.position, f.created_at, f.id
      )
      from public.trust_center_faqs f
      where f.organization_id = tc.organization_id and f.visible
    ), '[]'::jsonb),
    'certifications', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', c.name,
          'status', c.status::text,
          'issuer', c.issuer,
          'validFrom', to_char(c.valid_from, 'YYYY-MM-DD'),
          'validUntil', to_char(c.valid_until, 'YYYY-MM-DD'),
          'demo', c.demo
        )
        order by c.position, c.created_at, c.id
      )
      from public.certifications c
      where c.organization_id = tc.organization_id and c.publicly_visible
    ), '[]'::jsonb),
    'subprocessors', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'company', s.company,
          'purpose', s.purpose,
          'dataCategory', s.data_category,
          'region', s.region
        )
        order by s.position, s.created_at, s.id
      )
      from public.subprocessors s
      where s.organization_id = tc.organization_id and s.publicly_visible
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'documentId', tcd.document_id,
          'title', d.title,
          'description', tcd.description,
          'category', d.category
        )
        order by tcd.position, tcd.created_at, tcd.id
      )
      from public.trust_center_documents tcd
      join public.documents d on d.id = tcd.document_id
      where tcd.organization_id = tc.organization_id
        and tcd.publicly_requestable
        and d.state = 'active'
        and exists (
          select 1 from public.document_versions dv
          where dv.document_id = d.id and dv.processing_state = 'ready'
        )
    ), '[]'::jsonb)
  )
  from public.trust_centers tc
  where tc.slug = p_slug and tc.status = 'published';
$$;

revoke all on function public.get_trust_center_overview(text) from public, anon, authenticated;
grant execute on function public.get_trust_center_overview(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: submit_trust_access_request (anonymous; rate-limited; clickwrap)
-- ---------------------------------------------------------------------------

create or replace function public.submit_trust_access_request(
  p_slug text,
  p_name text,
  p_company text,
  p_email text,
  p_document_ids uuid[],
  p_accept_terms boolean,
  p_ip_hash text,
  p_ua_summary text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tc public.trust_centers;
  v_request_id uuid;
  v_valid_count integer;
  v_recipient record;
begin
  select * into v_tc from public.trust_centers
  where slug = p_slug and status = 'published';
  if v_tc.organization_id is null then
    -- Unknown and unpublished are the same answer (no existence leak).
    raise exception 'TRUST_CENTER_NOT_FOUND';
  end if;

  if p_name is null or char_length(btrim(p_name)) not between 1 and 120
    or p_company is null or char_length(btrim(p_company)) not between 1 and 160
    or p_email is null or char_length(btrim(p_email)) > 254
    or btrim(lower(p_email)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  then
    raise exception 'REQUEST_INPUT_INVALID';
  end if;

  if p_document_ids is null or cardinality(p_document_ids) not between 1 and 20
    or (select count(distinct doc) from unnest(p_document_ids) as t(doc)) <> cardinality(p_document_ids)
  then
    raise exception 'REQUEST_DOCUMENTS_INVALID';
  end if;

  if p_accept_terms is distinct from true then
    raise exception 'TERMS_NOT_ACCEPTED';
  end if;

  if btrim(v_tc.terms_version) = '' or btrim(v_tc.terms_text) = '' then
    raise exception 'TERMS_NOT_CONFIGURED';
  end if;

  select count(*) into v_valid_count
  from unnest(p_document_ids) as t(doc)
  where private.trust_document_requestable(v_tc.organization_id, doc);
  if v_valid_count <> cardinality(p_document_ids) then
    raise exception 'REQUEST_DOCUMENTS_INVALID';
  end if;

  -- Abuse control before any write: per-center 20/hour, per-IP-hash 5/hour.
  if not private.consume_rate_limit(
    'trust_submit:' || v_tc.organization_id::text, 20, 3600
  ) or not private.consume_rate_limit(
    'trust_submit_ip:' || coalesce(nullif(btrim(coalesce(p_ip_hash, '')), ''), 'unknown'), 5, 3600
  ) then
    raise exception 'RATE_LIMITED';
  end if;

  perform private.expire_overdue_trust_access();

  insert into public.access_requests (
    organization_id, prospect_name, prospect_company, prospect_email, state,
    requested_document_ids, request_expires_at, ip_hash, ua_summary
  ) values (
    v_tc.organization_id,
    btrim(p_name),
    btrim(p_company),
    lower(btrim(p_email)),
    case when v_tc.require_email_verification then 'submitted'::public.access_request_state
         else 'pending_review'::public.access_request_state end,
    p_document_ids,
    now() + interval '30 days',
    nullif(btrim(coalesce(p_ip_hash, '')), ''),
    nullif(btrim(coalesce(p_ua_summary, '')), '')
  )
  returning id into v_request_id;

  -- Clickwrap record against the STORED terms (browser supplied only the
  -- boolean). Hash pins the exact displayed text.
  insert into public.nda_acceptances (
    organization_id, access_request_id, terms_version, terms_hash, ip_hash
  ) values (
    v_tc.organization_id,
    v_request_id,
    v_tc.terms_version,
    encode(sha256(convert_to(v_tc.terms_text, 'utf8')), 'hex'),
    nullif(btrim(coalesce(p_ip_hash, '')), '')
  );

  -- Owners + admins get an in-app notification (J8 step 7). Actor is
  -- anonymous: nobody is excluded by the actor check.
  for v_recipient in
    select user_id from public.organization_members
    where organization_id = v_tc.organization_id
      and role in ('owner', 'admin')
  loop
    perform private.insert_notification(
      v_tc.organization_id,
      v_recipient.user_id,
      'trust_access.requested',
      'access_request',
      v_request_id,
      null,
      jsonb_build_object('document_count', cardinality(p_document_ids))
    );
  end loop;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_tc.organization_id,
    null,
    'trust_access.request_submitted',
    'access_request',
    v_request_id,
    jsonb_build_object('document_count', cardinality(p_document_ids))
  );

  return v_request_id;
end;
$$;

revoke all on function public.submit_trust_access_request(text, text, text, text, uuid[], boolean, text, text) from public, anon, authenticated;
grant execute on function public.submit_trust_access_request(text, text, text, text, uuid[], boolean, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: confirm_trust_access_request (email-verification step, D029)
-- ---------------------------------------------------------------------------

-- The app verifies the stateless HMAC link BEFORE calling this; here we only
-- perform the idempotent submitted → pending_review flip. Re-visits and
-- expired links are silent no-ops — the page state comes from a separate
-- authenticated rendering, so nothing leaks through this call.
create or replace function public.confirm_trust_access_request(p_request_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.access_requests
  set state = 'pending_review'
  where id = p_request_id
    and state = 'submitted'
    and request_expires_at > now();
$$;

revoke all on function public.confirm_trust_access_request(uuid) from public, anon, authenticated;
grant execute on function public.confirm_trust_access_request(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: trust_accept_terms (prospect re-accepts when terms changed)
-- ---------------------------------------------------------------------------

create or replace function public.trust_accept_terms(
  p_slug text,
  p_raw_token text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request public.access_requests;
  v_tc public.trust_centers;
  v_acceptance_id uuid;
begin
  v_request := private.resolve_trust_access_request(p_slug, p_raw_token);

  select * into v_tc from public.trust_centers
  where organization_id = v_request.organization_id;

  insert into public.nda_acceptances (
    organization_id, access_request_id, terms_version, terms_hash, ip_hash
  ) values (
    v_request.organization_id,
    v_request.id,
    v_tc.terms_version,
    encode(sha256(convert_to(v_tc.terms_text, 'utf8')), 'hex'),
    v_request.ip_hash
  )
  returning id into v_acceptance_id;
  return v_acceptance_id;
end;
$$;

revoke all on function public.trust_accept_terms(text, text) from public, anon, authenticated;
grant execute on function public.trust_accept_terms(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: review_trust_access_request (owner/admin approve/deny; returns the
-- prospect link token EXACTLY ONCE on approval)
-- ---------------------------------------------------------------------------

create or replace function public.review_trust_access_request(
  p_request_id uuid,
  p_decision text,
  p_document_ids uuid[],
  p_grant_days integer
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_request public.access_requests;
  v_doc record;
  v_token text;
  v_hash text;
  v_count integer := 0;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_request from public.access_requests
  where id = p_request_id;
  if v_request.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if not private.is_org_member(v_request.organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  perform private.expire_overdue_trust_access();

  if v_request.state <> 'pending_review' then
    raise exception 'REQUEST_NOT_PENDING';
  end if;

  if p_decision = 'denied' then
    if p_document_ids is not null and cardinality(p_document_ids) > 0 then
      raise exception 'DECISION_INVALID';
    end if;
    update public.access_requests
    set state = 'denied', resolved_at = now(), resolved_by = v_actor
    where id = v_request.id;
    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_request.organization_id, v_actor, 'trust_access.denied', 'access_request', v_request.id,
            jsonb_build_object('document_count', cardinality(v_request.requested_document_ids)));
    return null;
  end if;

  if p_decision <> 'approved' then
    raise exception 'DECISION_INVALID';
  end if;

  -- Grants ⊆ requested (an admin can never grant documents the prospect did
  -- not ask for) AND every one still grantable right now.
  if p_document_ids is null or cardinality(p_document_ids) not between 1 and 20
    or (select count(distinct doc) from unnest(p_document_ids) as t(doc)) <> cardinality(p_document_ids)
    or not p_document_ids <@ v_request.requested_document_ids
  then
    raise exception 'REQUEST_DOCUMENTS_INVALID';
  end if;
  if p_grant_days is null or p_grant_days not between 1 and 30 then
    raise exception 'GRANT_DAYS_INVALID';
  end if;
  select count(*) into v_count
  from unnest(p_document_ids) as t(doc)
  where private.trust_document_requestable(v_request.organization_id, doc);
  if v_count <> cardinality(p_document_ids) then
    raise exception 'REQUEST_DOCUMENTS_INVALID';
  end if;

  -- One grant per document with its own expiry (J9 step 3).
  for v_doc in select doc from unnest(p_document_ids) as t(doc)
  loop
    insert into public.document_access_grants (
      organization_id, access_request_id, document_id, expires_at, granted_by
    ) values (
      v_request.organization_id, v_request.id, v_doc,
      now() + make_interval(days => p_grant_days), v_actor
    )
    on conflict (access_request_id, document_id) do update set
      state = 'active',
      expires_at = excluded.expires_at,
      granted_by = excluded.granted_by;
  end loop;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_hash := encode(sha256(convert_to(v_token, 'utf8')), 'hex');

  update public.access_requests
  set state = 'approved',
      prospect_token_hash = v_hash,
      resolved_at = now(),
      resolved_by = v_actor
  where id = v_request.id;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_request.organization_id, v_actor, 'trust_access.approved', 'access_request', v_request.id,
          jsonb_build_object('document_count', cardinality(p_document_ids), 'grant_days', p_grant_days));

  return v_token;
end;
$$;

revoke all on function public.review_trust_access_request(uuid, text, uuid[], integer) from public, anon, authenticated;
grant execute on function public.review_trust_access_request(uuid, text, uuid[], integer) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: revoke_access_grant (owner/admin kill switch for a single grant)
-- ---------------------------------------------------------------------------

create or replace function public.revoke_access_grant(p_grant_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_grant public.document_access_grants;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  select * into v_grant from public.document_access_grants where id = p_grant_id;
  if v_grant.id is null then
    raise exception 'GRANT_NOT_FOUND';
  end if;
  if not private.is_org_member(v_grant.organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;
  if v_grant.state <> 'active' then
    raise exception 'GRANT_NOT_ACTIVE';
  end if;

  update public.document_access_grants
  set state = 'revoked'
  where id = v_grant.id;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_grant.organization_id, v_actor, 'trust_access.grant_revoked', 'access_request', v_grant.access_request_id,
          jsonb_build_object('document_id', v_grant.document_id));
end;
$$;

revoke all on function public.revoke_access_grant(uuid) from public, anon, authenticated;
grant execute on function public.revoke_access_grant(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: trust_prospect_documents (the gated "your documents" view)
-- ---------------------------------------------------------------------------

create or replace function public.trust_prospect_documents(
  p_slug text,
  p_raw_token text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request public.access_requests;
  v_tc public.trust_centers;
  v_terms_current boolean;
begin
  perform private.expire_overdue_trust_access();
  v_request := private.resolve_trust_access_request(p_slug, p_raw_token);

  select * into v_tc from public.trust_centers
  where organization_id = v_request.organization_id;

  -- Terms may have changed since submission: the page shows clickwrap again
  -- unless an acceptance of the CURRENT version exists.
  select exists (
    select 1 from public.nda_acceptances na
    where na.access_request_id = v_request.id
      and na.terms_version = v_tc.terms_version
  ) into v_terms_current;

  return jsonb_build_object(
    'displayName', v_tc.display_name,
    'termsVersion', v_tc.terms_version,
    'termsText', v_tc.terms_text,
    'termsCurrent', v_terms_current,
    'requestExpiresAt', v_request.request_expires_at,
    'documents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'documentId', g.document_id,
          'title', d.title,
          'description', tcd.description,
          'filename', split_part(dv.storage_path, '/', 4),
          'byteSize', dv.byte_size,
          'expiresAt', g.expires_at
        )
        order by tcd.position, tcd.created_at
      )
      from public.document_access_grants g
      join public.documents d on d.id = g.document_id and d.state = 'active'
      join public.trust_center_documents tcd
        on tcd.document_id = g.document_id
        and tcd.organization_id = g.organization_id
      cross join lateral private.latest_ready_document_version(g.document_id) dv
      where g.access_request_id = v_request.id
        and g.state = 'active'
        and g.expires_at > now()
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.trust_prospect_documents(text, text) from public, anon, authenticated;
grant execute on function public.trust_prospect_documents(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: trust_download_document (validates everything, writes the event,
-- returns the path for the app to sign server-side)
-- ---------------------------------------------------------------------------

create or replace function public.trust_download_document(
  p_slug text,
  p_raw_token text,
  p_document_id uuid,
  p_ip_hash text,
  p_ua_summary text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request public.access_requests;
  v_grant public.document_access_grants;
  v_version public.document_versions;
begin
  perform private.expire_overdue_trust_access();
  v_request := private.resolve_trust_access_request(p_slug, p_raw_token);

  select * into v_grant
  from public.document_access_grants
  where access_request_id = v_request.id
    and document_id = p_document_id
  limit 1;

  -- Wrong document, wrong org, or no grant: one generic answer. A grant from
  -- another request/org simply does not match this (request, document) pair.
  if v_grant.id is null or v_grant.state <> 'active' or v_grant.expires_at <= now() then
    raise exception 'DOWNLOAD_NOT_ALLOWED';
  end if;

  select * into v_version
  from private.latest_ready_document_version(p_document_id);
  if v_version.id is null then
    raise exception 'DOWNLOAD_NOT_ALLOWED';
  end if;

  insert into public.download_events (
    organization_id, access_request_id, grant_id, document_id,
    document_version_id, ip_hash, ua_summary
  ) values (
    v_request.organization_id, v_request.id, v_grant.id, p_document_id,
    v_version.id,
    nullif(btrim(coalesce(p_ip_hash, '')), ''),
    nullif(btrim(coalesce(p_ua_summary, '')), '')
  );

  return jsonb_build_object(
    'storagePath', v_version.storage_path,
    'filename', split_part(v_version.storage_path, '/', 4),
    'mimeType', v_version.mime_type
  );
end;
$$;

revoke all on function public.trust_download_document(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.trust_download_document(text, text, uuid, text, text) to anon, authenticated;
