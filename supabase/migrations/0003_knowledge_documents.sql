-- 0003_knowledge_documents.sql — Week 3: knowledge base, private documents, ingestion.
--
-- Plan §8/§9 + AGENTS.md rule 7: every table ships WITH its grants and RLS
-- policies in this same migration. Forward-only; never edit after applying.
--
-- Design notes (deliberate decisions):
-- * Permission matrix (PRD §5): owner + admin upload/manage evidence;
--   reviewer + viewer read only. Every write policy below checks the
--   owner/admin pair; selects are any-membership.
-- * Processing-state enum (PRD §7.6 open question "decide by W3" — resolved
--   here): `pending → parsing → embedding → ready | failed`. Chunking is an
--   in-memory step between parse and embed, so it has no persisted state.
--   `processing_error_code` stores SAFE CONSTANT CODES only — never parser
--   messages, paths, or content (plan §16 log hygiene). Retries are capped at
--   3 attempts by `reset_document_version_for_retry`, which also wipes any
--   previously written chunks so reprocessing is idempotent.
-- * document_versions rows are content-immutable (BEFORE UPDATE trigger):
--   only processing columns may change. Re-uploading changed content creates
--   a new version, never an in-place edit (PRD §6 "immutable document_versions").
-- * Chunks are inserted only after embeddings succeed, in one statement, so
--   `embedding` is effectively NOT NULL; the column stays nullable so a
--   future ingestion mode can stage chunks before embedding. Retrieval
--   always filters `embedding is not null`.
-- * Storage is a single PRIVATE bucket `documents`. Object keys are built
--   server-side by `create_document_upload` as
--   `{organization_id}/{document_id}/{version_id}/{sanitized_filename}` —
--   clients never choose the path. Policies re-derive the org from the FIRST
--   path segment (plan §7) via `private.storage_org_of`, which returns NULL
--   for malformed keys (no cast errors, deny by default).
-- * `match_org_evidence` is the cross-tenant-sensitive surface: it refuses
--   non-members BEFORE touching data, restricts chunks to the CURRENT ready
--   version of ACTIVE documents, and combines vector similarity with
--   full-text rank. Week 5 tunes weights/recall; Week 3 locks the isolation.
-- * Audit events for document/entry lifecycle are written by AFTER triggers
--   with a SECURITY DEFINER writer, so the audit row commits in the same
--   transaction as the change it describes (or neither happens). Metadata
--   records state transitions only — never titles or content.
-- * All rejections use stable uppercase error codes as the exception MESSAGE
--   (same convention as 0001) — mapped to safe copy in the app.

-- ---------------------------------------------------------------------------
-- Extensions, enums, limits
-- ---------------------------------------------------------------------------

-- pgvector lives in the `extensions` schema on Supabase; every reference to
-- the type/operator class below is schema-qualified so the migration never
-- depends on a particular search_path.
create extension if not exists vector with schema extensions;

create type public.document_state as enum ('active', 'archived');

-- Resolves PRD §7.6 (open question, decide by W3). See header notes.
create type public.document_processing_state as enum
  ('pending', 'parsing', 'embedding', 'ready', 'failed');

create type public.knowledge_entry_review_state as enum
  ('draft', 'approved', 'needs_review', 'retired');

-- Hard ingestion ceilings (plan §9: 10 MB/doc default; Week 8 plan
-- entitlements may lower them per plan, never raise them past this backstop).
create table private.ingestion_limits (
  id boolean primary key default true check (id),
  max_document_bytes integer not null default 10485760,
  max_document_versions integer not null default 100,
  max_retry_attempts integer not null default 3,
  constraint ingestion_limits_singleton check (id)
);

insert into private.ingestion_limits (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  -- Free text (≤80 chars): buyers categorize per their own taxonomy (plan §8
  -- has no enum; UI offers suggestions but the DB stays open).
  category text not null default 'general' check (char_length(btrim(category)) between 1 and 80),
  -- Product/geo/topic tags; Zod validates each element (1–40 chars, trimmed);
  -- the DB enforces only cardinality (CHECK may not contain subqueries).
  tags text[] not null default '{}'::text[] check (cardinality(tags) <= 20),
  owner_id uuid references auth.users (id) on delete set null,
  review_by date,
  state public.document_state not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_organization_state_idx on public.documents (organization_id, state);
create index documents_organization_category_idx on public.documents (organization_id, category);
create index documents_organization_updated_idx on public.documents (organization_id, updated_at desc);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  -- Denormalized from documents so RLS and storage-path checks never need a
  -- join; set in the same transaction/insert as the document row it belongs
  -- to, so it can never drift.
  organization_id uuid not null references public.organizations (id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  -- {organization_id}/{document_id}/{version_id}/{sanitized_filename},
  -- assembled by create_document_upload; unique so concurrent versions of the
  -- same file can never overwrite each other in the bucket.
  storage_path text not null unique check (char_length(storage_path) <= 1024),
  mime_type text not null,
  byte_size integer not null check (byte_size between 1 and 10485760),
  -- SHA-256 hex of the uploaded bytes; the ingestion route recomputes it from
  -- storage and refuses mismatches (defense against truncated uploads).
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  parser_version text,
  processing_state public.document_processing_state not null default 'pending',
  -- Safe constant code only (e.g. 'UNSUPPORTED_TYPE', 'PARSER_FAILED').
  processing_error_code text check (
    processing_error_code is null
    or (char_length(processing_error_code) between 4 and 60
        and processing_error_code ~ '^[A-Z0-9_]+$')
  ),
  processing_attempts integer not null default 0 check (processing_attempts between 0 and 100),
  page_count integer check (page_count is null or page_count between 0 and 100000),
  char_count integer check (char_count is null or char_count between 0 and 100000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, version_number)
);

create index document_versions_organization_state_idx
  on public.document_versions (organization_id, processing_state);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  version_id uuid not null references public.document_versions (id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  -- Nearest heading/section label preserved during normalization (plan §9).
  section text not null default '' check (char_length(section) <= 300),
  content text not null check (char_length(content) between 1 and 8000),
  token_count integer not null check (token_count between 1 and 4000),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  -- text-embedding-3-small dimension (plan §6). Changing OPENAI_EMBEDDING_MODEL
  -- to a different dimension requires a migration — documented in docs/.
  embedding extensions.vector(1536),
  search_vector tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  unique (version_id, sequence)
);

create index document_chunks_organization_idx on public.document_chunks (organization_id);
create index document_chunks_embedding_hnsw_idx
  on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index document_chunks_search_idx on public.document_chunks using gin (search_vector);

create table public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  question text not null check (char_length(btrim(question)) between 1 and 500),
  answer text not null check (char_length(btrim(answer)) between 1 and 10000),
  category text not null default 'general' check (char_length(btrim(category)) between 1 and 80),
  tags text[] not null default '{}'::text[] check (cardinality(tags) <= 20),
  owner_id uuid references auth.users (id) on delete set null,
  review_state public.knowledge_entry_review_state not null default 'draft',
  review_by date,
  search_vector tsvector generated always as (
    to_tsvector('english', question || ' ' || answer)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index knowledge_entries_organization_state_idx
  on public.knowledge_entries (organization_id, review_state);
create index knowledge_entries_search_idx on public.knowledge_entries using gin (search_vector);

-- Immutable edit history (PRD §6): SELECT-only for clients; rows are written
-- exclusively inside save_knowledge_entry's transaction.
create table public.knowledge_entry_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entry_id uuid not null references public.knowledge_entries (id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  question text not null,
  answer text not null,
  category text not null,
  tags text[] not null,
  review_state public.knowledge_entry_review_state not null,
  edited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (entry_id, version_number)
);

create index knowledge_entry_versions_entry_idx
  on public.knowledge_entry_versions (entry_id, version_number desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.documents
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.document_versions
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.knowledge_entries
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- document_versions immutability (PRD §6: versions are immutable)
-- ---------------------------------------------------------------------------

create or replace function private.protect_document_version_content()
returns trigger
language plpgsql
volatile
as $$
begin
  if new.document_id is distinct from old.document_id
     or new.organization_id is distinct from old.organization_id
     or new.version_number is distinct from old.version_number
     or new.storage_path is distinct from old.storage_path
     or new.mime_type is distinct from old.mime_type
     or new.byte_size is distinct from old.byte_size
     or new.checksum_sha256 is distinct from old.checksum_sha256
  then
    raise exception 'VERSION_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger protect_document_version_content
  before update on public.document_versions
  for each row execute function private.protect_document_version_content();

-- ---------------------------------------------------------------------------
-- Audit triggers (same-transaction audit rows; metadata = state transitions)
-- ---------------------------------------------------------------------------

create or replace function private.audit_document_lifecycle()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.organization_id, auth.uid(), 'document.created', 'document', new.id,
            jsonb_build_object('state', new.state::text));
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.state = 'archived' and new.state = 'active' then
      v_action := 'document.restored';
    elsif new.state = 'archived' then
      v_action := 'document.archived';
    else
      v_action := 'document.updated';
    end if;
    v_metadata := jsonb_build_object('from', old.state::text, 'to', new.state::text);
    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.organization_id, auth.uid(), v_action, 'document', new.id, v_metadata);
    return new;
  end if;

  -- DELETE
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (old.organization_id, auth.uid(), 'document.deleted', 'document', old.id,
          jsonb_build_object('from', old.state::text));
  return old;
end;
$$;

create trigger audit_document_lifecycle
  after insert or update or delete on public.documents
  for each row execute function private.audit_document_lifecycle();

create or replace function private.audit_knowledge_entry_lifecycle()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.organization_id, auth.uid(), 'knowledge_entry.created', 'knowledge_entry', new.id,
            jsonb_build_object('review_state', new.review_state::text));
    return new;
  end if;

  if tg_op = 'UPDATE' then
    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.organization_id, auth.uid(), 'knowledge_entry.updated', 'knowledge_entry', new.id,
            jsonb_build_object('from', old.review_state::text, 'to', new.review_state::text));
    return new;
  end if;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (old.organization_id, auth.uid(), 'knowledge_entry.deleted', 'knowledge_entry', old.id,
          jsonb_build_object('from', old.review_state::text));
  return old;
end;
$$;

create trigger audit_knowledge_entry_lifecycle
  after insert or update or delete on public.knowledge_entries
  for each row execute function private.audit_knowledge_entry_lifecycle();

-- ---------------------------------------------------------------------------
-- Storage: private bucket + path-derived org policies (plan §7)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- First path segment → org uuid, or NULL when the key is malformed. Policies
-- deny on NULL, so garbage paths can neither pass nor raise.
create or replace function private.storage_org_of(p_path text)
returns uuid
language sql
stable
as $$
  select case
    when split_part(p_path, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (split_part(p_path, '/', 1))::uuid
  end;
$$;

-- Enforces the full four-segment key shape. The filename segment may not be
-- empty, dot-relative, or contain backslashes/control characters.
create or replace function private.valid_document_object_path(p_path text)
returns boolean
language sql
stable
as $$
  select
    private.storage_org_of(p_path) is not null
    and cardinality(storage.foldername(p_path)) = 4
    and (storage.foldername(p_path))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (storage.foldername(p_path))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (storage.foldername(p_path))[4] ~ '^[^[:cntrl:]\\]{1,200}$'
    and (storage.foldername(p_path))[4] not in ('.', '..')
$$;

-- The bucket is private: no anon policy exists at all, so anonymous access is
-- denied by RLS with nothing to revoke (storage.objects ships with RLS
-- enabled on Supabase). Objects are immutable: no UPDATE policy — a changed
-- file means a new version id, therefore a new key.

create policy "documents_storage_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and private.is_org_member(private.storage_org_of(name))
  );

create policy "documents_storage_insert_manager" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and private.is_org_member(private.storage_org_of(name), array['owner', 'admin']::public.app_role[])
    and private.valid_document_object_path(name)
  );

create policy "documents_storage_delete_manager" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and private.is_org_member(private.storage_org_of(name), array['owner', 'admin']::public.app_role[])
    and private.valid_document_object_path(name)
  );

-- ---------------------------------------------------------------------------
-- RPC: create document / version + upload intent (atomic, server-built path)
-- ---------------------------------------------------------------------------

create or replace function public.create_document_upload(
  p_organization_id uuid,
  p_title text,
  p_category text,
  p_tags text[],
  p_review_by date,
  p_filename text,
  p_mime_type text,
  p_byte_size integer,
  p_checksum_sha256 text,
  p_document_id uuid default null
)
returns table (document_id uuid, version_id uuid, storage_path text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_status public.organization_status;
  v_document_id uuid;
  v_version_id uuid;
  v_version_number integer;
  v_limits private.ingestion_limits%rowtype;
  v_existing_org uuid;
  v_filename text := btrim(coalesce(p_filename, ''));
  v_storage_path text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_limits from private.ingestion_limits where id = true;

  if not private.is_org_member(p_organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_org_status from public.organizations where id = p_organization_id;
  if v_org_status is distinct from 'active' then
    raise exception 'ORG_INACTIVE';
  end if;

  -- ---- input validation (stable codes; app mirrors for friendly copy) -----
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200
     or p_category is null or char_length(btrim(p_category)) not between 1 and 80
     or p_tags is null or cardinality(p_tags) > 20
  then
    raise exception 'DOCUMENT_INPUT_INVALID';
  end if;

  if v_filename !~ '^[^[:cntrl:]\\]{1,200}$' or v_filename in ('.', '..') then
    raise exception 'DOCUMENT_INPUT_INVALID';
  end if;

  if p_mime_type not in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ) then
    raise exception 'DOCUMENT_TYPE_UNSUPPORTED';
  end if;

  if p_byte_size is null or p_byte_size < 1 then
    raise exception 'DOCUMENT_EMPTY';
  end if;
  if p_byte_size > v_limits.max_document_bytes then
    raise exception 'DOCUMENT_TOO_LARGE';
  end if;

  if p_checksum_sha256 is null or p_checksum_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'DOCUMENT_INPUT_INVALID';
  end if;

  -- ---- resolve or create the parent document ------------------------------
  if p_document_id is null then
    insert into public.documents (organization_id, title, category, tags, owner_id, review_by)
    values (p_organization_id, btrim(p_title), btrim(p_category), p_tags, v_user_id, p_review_by)
    returning id into v_document_id;
  else
    -- Same-shape answer for "doesn't exist" and "exists but not yours": a
    -- cross-tenant probe must not learn which one it hit.
    select organization_id into v_existing_org
    from public.documents
    where id = p_document_id;

    if v_existing_org is null or v_existing_org <> p_organization_id then
      raise exception 'DOCUMENT_NOT_FOUND';
    end if;

    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id)
    values (p_organization_id, v_user_id, 'document.version_added', 'document', p_document_id);

    v_document_id := p_document_id;
  end if;

  select coalesce(max(dv.version_number), 0) + 1 into v_version_number
  from public.document_versions dv
  where dv.document_id = v_document_id;

  if v_version_number > v_limits.max_document_versions then
    raise exception 'VERSION_LIMIT_REACHED';
  end if;

  -- ---- version row + server-built storage path (one insert) ---------------
  v_version_id := gen_random_uuid();
  v_storage_path := p_organization_id::text || '/' || v_document_id::text
                    || '/' || v_version_id::text || '/' || v_filename;

  insert into public.document_versions (
    id, document_id, organization_id, version_number, storage_path,
    mime_type, byte_size, checksum_sha256
  ) values (
    v_version_id, v_document_id, p_organization_id, v_version_number, v_storage_path,
    p_mime_type, p_byte_size, p_checksum_sha256
  );

  return query select v_document_id, v_version_id, v_storage_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: retry preparation (idempotent reprocessing, cap enforced)
-- ---------------------------------------------------------------------------

-- Wipes any chunks from a previous attempt and resets a FAILED version to
-- `pending` so the ingestion route can run again. Enforces the retry cap.
create or replace function public.reset_document_version_for_retry(
  p_organization_id uuid,
  p_document_id uuid,
  p_version_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limits private.ingestion_limits%rowtype;
  v_state public.document_processing_state;
  v_attempts integer;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_limits from private.ingestion_limits where id = true;

  if not private.is_org_member(p_organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  select processing_state, processing_attempts into v_state, v_attempts
  from public.document_versions
  where id = p_version_id
    and document_id = p_document_id
    and organization_id = p_organization_id;

  -- Same answer for unknown ids and ids outside this org (no existence leak).
  if v_state is null then
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;

  if v_state <> 'failed' then
    raise exception 'RETRY_NOT_ALLOWED';
  end if;

  if v_attempts >= v_limits.max_retry_attempts then
    raise exception 'RETRY_LIMIT_REACHED';
  end if;

  update public.document_versions
  set processing_state = 'pending',
      processing_error_code = null,
      processing_attempts = processing_attempts + 1
  where id = p_version_id;

  delete from public.document_chunks
  where version_id = p_version_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: knowledge entry save (entry + immutable version row, one transaction)
-- ---------------------------------------------------------------------------

create or replace function public.save_knowledge_entry(
  p_organization_id uuid,
  p_question text,
  p_answer text,
  p_category text,
  p_tags text[],
  p_review_state public.knowledge_entry_review_state,
  p_review_by date,
  p_entry_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry_id uuid;
  v_existing_org uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not private.is_org_member(p_organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  if p_question is null or char_length(btrim(p_question)) not between 1 and 500
     or p_answer is null or char_length(btrim(p_answer)) not between 1 and 10000
     or p_category is null or char_length(btrim(p_category)) not between 1 and 80
     or p_tags is null or cardinality(p_tags) > 20
     or p_review_state is null
  then
    raise exception 'ENTRY_INPUT_INVALID';
  end if;

  if p_entry_id is null then
    insert into public.knowledge_entries (
      organization_id, question, answer, category, tags, owner_id, review_state, review_by
    )
    values (
      p_organization_id, btrim(p_question), btrim(p_answer), btrim(p_category),
      p_tags, v_user_id, p_review_state, p_review_by
    )
    returning id into v_entry_id;

    insert into public.knowledge_entry_versions (
      organization_id, entry_id, version_number, question, answer, category, tags, review_state, edited_by
    )
    values (
      p_organization_id, v_entry_id, 1, btrim(p_question), btrim(p_answer),
      btrim(p_category), p_tags, p_review_state, v_user_id
    );

    return v_entry_id;
  end if;

  select organization_id into v_existing_org
  from public.knowledge_entries
  where id = p_entry_id;

  -- Same answer for unknown ids and ids outside this org (no existence leak).
  if v_existing_org is null or v_existing_org <> p_organization_id then
    raise exception 'ENTRY_NOT_FOUND';
  end if;

  update public.knowledge_entries
  set question = btrim(p_question),
      answer = btrim(p_answer),
      category = btrim(p_category),
      tags = p_tags,
      review_state = p_review_state,
      review_by = p_review_by
  where id = p_entry_id;

  insert into public.knowledge_entry_versions (
    organization_id, entry_id, version_number, question, answer, category, tags, review_state, edited_by
  )
  values (
    p_organization_id,
    p_entry_id,
    (select coalesce(max(version_number), 0) + 1 from public.knowledge_entry_versions where entry_id = p_entry_id),
    btrim(p_question),
    btrim(p_answer),
    btrim(p_category),
    p_tags,
    p_review_state,
    v_user_id
  );

  return p_entry_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: org-scoped hybrid evidence search (plan §10 shape, Week 3 isolation)
-- ---------------------------------------------------------------------------

create or replace function public.match_org_evidence(
  p_organization_id uuid,
  p_query_embedding extensions.vector(1536),
  p_query_text text,
  p_match_count integer default 8
)
returns table (
  source_type text,
  source_id uuid,
  document_id uuid,
  document_title text,
  section text,
  content text,
  vector_similarity double precision,
  text_rank double precision,
  combined_score double precision
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Tenancy BEFORE data: a non-member (or cross-org probe) gets FORBIDDEN —
  -- never an empty result that could be probed for behavioral differences.
  if not private.is_org_member(p_organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  if p_match_count < 1 or p_match_count > 50 then
    raise exception 'EVIDENCE_QUERY_INVALID';
  end if;

  return query
  with query as (
    select websearch_to_tsquery('english', coalesce(p_query_text, '')) as tsq
  ),
  current_versions as (
    select distinct on (v.document_id)
      v.id as version_id, v.document_id
    from public.document_versions v
    join public.documents d on d.id = v.document_id
    where d.organization_id = p_organization_id
      and d.state = 'active'
      and v.processing_state = 'ready'
    order by v.document_id, v.version_number desc
  ),
  chunk_scores as (
    select
      c.id as chunk_id,
      c.document_id,
      c.section,
      c.content,
      case when p_query_embedding is null then 0.0
           else greatest(0.0::double precision, (1.0::double precision - (c.embedding <=> p_query_embedding)::double precision))
      end as vector_similarity,
      coalesce(ts_rank_cd(c.search_vector, query.tsq), 0.0)::double precision as raw_rank
    from public.document_chunks c
    join current_versions cv on cv.version_id = c.version_id
    cross join query
    where c.embedding is not null
      and (p_query_embedding is null or (c.embedding <=> p_query_embedding) < 0.85)
  ),
  max_chunk_rank as (
    select greatest(max(raw_rank), 0.0001) as max_rank from chunk_scores
  ),
  ranked_chunks as (
    select
      'document_chunk'::text as source_type,
      cs.chunk_id as source_id,
      cs.document_id,
      d.title as document_title,
      cs.section,
      cs.content,
      cs.vector_similarity,
      (cs.raw_rank / m.max_rank) as text_rank,
      (0.75 * cs.vector_similarity + 0.25 * cs.raw_rank / m.max_rank) as combined_score
    from chunk_scores cs
    join public.documents d on d.id = cs.document_id
    cross join max_chunk_rank m
    where cs.vector_similarity > 0.05 or cs.raw_rank > 0
    order by combined_score desc
    limit least(p_match_count, 50)
  ),
  entry_scores as (
    select
      ke.id as entry_id,
      ts_rank_cd(ke.search_vector, query.tsq)::double precision as raw_rank
    from public.knowledge_entries ke
    cross join query
    where ke.organization_id = p_organization_id
      and ke.review_state = 'approved'
      and query.tsq::text <> ''
      and ke.search_vector @@ query.tsq
  ),
  max_entry_rank as (
    select greatest(max(raw_rank), 0.0001) as max_rank from entry_scores
  ),
  ranked_entries as (
    select
      'knowledge_entry'::text as source_type,
      es.entry_id as source_id,
      null::uuid as document_id,
      null::text as document_title,
      ''::text as section,
      left(ke.question || E'\n\n' || ke.answer, 8000) as content,
      0.0::double precision as vector_similarity,
      (es.raw_rank / m.max_rank) as text_rank,
      (0.25 * es.raw_rank / m.max_rank) as combined_score
    from entry_scores es
    join public.knowledge_entries ke on ke.id = es.entry_id
    cross join max_entry_rank m
    order by combined_score desc
    limit least(p_match_count, 50)
  )
  select * from ranked_chunks
  union all
  select * from ranked_entries
  order by combined_score desc
  limit least(p_match_count, 50);
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock down function privileges (functions are EXECUTE-to-PUBLIC by default)
-- ---------------------------------------------------------------------------

revoke all on function public.create_document_upload(uuid, text, text, text[], date, text, text, integer, text, uuid) from public, anon;
revoke all on function public.reset_document_version_for_retry(uuid, uuid, uuid) from public, anon;
revoke all on function public.save_knowledge_entry(uuid, text, text, text, text[], public.knowledge_entry_review_state, date, uuid) from public, anon;
revoke all on function public.match_org_evidence(uuid, extensions.vector(1536), text, integer) from public, anon;
grant execute on function public.create_document_upload(uuid, text, text, text[], date, text, text, integer, text, uuid) to authenticated;
grant execute on function public.reset_document_version_for_retry(uuid, uuid, uuid) to authenticated;
grant execute on function public.save_knowledge_entry(uuid, text, text, text, text[], public.knowledge_entry_review_state, date, uuid) to authenticated;
grant execute on function public.match_org_evidence(uuid, extensions.vector(1536), text, integer) to authenticated;

revoke all on function private.storage_org_of(text) from public, anon;
revoke all on function private.valid_document_object_path(text) from public, anon;
revoke all on function private.protect_document_version_content() from public, anon;
revoke all on function private.audit_document_lifecycle() from public, anon;
revoke all on function private.audit_knowledge_entry_lifecycle() from public, anon;
grant execute on function private.storage_org_of(text) to authenticated;
grant execute on function private.valid_document_object_path(text) to authenticated;

revoke all on all tables in schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS + explicit grants (revoke Supabase default privileges first)
-- ---------------------------------------------------------------------------

revoke all on public.documents, public.document_versions, public.document_chunks,
              public.knowledge_entries, public.knowledge_entry_versions
  from anon, authenticated;

alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_chunks enable row level security;
alter table public.knowledge_entries enable row level security;
alter table public.knowledge_entry_versions enable row level security;

-- documents ---------------------------------------------------------------
-- (insert happens only via create_document_upload; no INSERT policy)

grant select, delete on public.documents to authenticated;
grant update (title, category, tags, review_by, state) on public.documents to authenticated;

create policy "documents_select_member" on public.documents
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy "documents_update_manager" on public.documents
  for update to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]))
  with check (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "documents_delete_manager" on public.documents
  for delete to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

-- document_versions -------------------------------------------------------
-- (insert happens only via create_document_upload; delete only via cascade)

grant select on public.document_versions to authenticated;
grant update (parser_version, processing_state, processing_error_code, processing_attempts, page_count, char_count)
  on public.document_versions to authenticated;

create policy "document_versions_select_member" on public.document_versions
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy "document_versions_update_manager" on public.document_versions
  for update to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]))
  with check (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

-- document_chunks ---------------------------------------------------------

grant select, insert, delete on public.document_chunks to authenticated;

create policy "document_chunks_select_member" on public.document_chunks
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy "document_chunks_insert_manager" on public.document_chunks
  for insert to authenticated
  with check (
    private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[])
    and exists (
      select 1 from public.document_versions v
      where v.id = version_id
        and v.organization_id = organization_id
        and v.document_id = document_id
    )
  );

create policy "document_chunks_delete_manager" on public.document_chunks
  for delete to authenticated
  using (
    private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[])
    and exists (
      select 1 from public.document_versions v
      where v.id = version_id
        and v.organization_id = organization_id
        and v.document_id = document_id
    )
  );

-- knowledge_entries -------------------------------------------------------
-- (insert/update happen only via save_knowledge_entry so the entry row and
-- its immutable version row can never diverge)

grant select, delete on public.knowledge_entries to authenticated;

create policy "knowledge_entries_select_member" on public.knowledge_entries
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy "knowledge_entries_delete_manager" on public.knowledge_entries
  for delete to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

-- knowledge_entry_versions ------------------------------------------------

grant select on public.knowledge_entry_versions to authenticated;

create policy "knowledge_entry_versions_select_member" on public.knowledge_entry_versions
  for select to authenticated
  using (private.is_org_member(organization_id));

-- No INSERT/UPDATE/DELETE policies at all: the version history is append-only
-- by privilege, not just by convention.
