-- 0010_questionnaires.sql — Week 4: questionnaire import, editor, answers, comments.
--
-- Plan §8/§9/§18-W4 + AGENTS.md rule 7: every table ships WITH its grants and
-- RLS policies in this same migration. Forward-only; never edit after applying.
--
-- Design notes (deliberate decisions):
-- * Permission matrix (plan §4/PRD §5): owner + admin + reviewer import
--   questionnaires, edit/approve answers, comment, assign, and export;
--   viewer is read-only. Every write policy/RPC below checks the O/A/R
--   triple — W3's owner/admin pair was for evidence management, questionnaires
--   are reviewer workflow surfaces.
-- * Lifecycle enums follow PRD §7.1/§7.2. The `answer_status` enum adopts the
--   PRD §7.2 MERGED lifecycle (D010 pre-adoption, owner-confirmed 2026-09-02):
--   W4 exercises the manual path (empty/answered/in_review/changes_requested/
--   rejected/approved); the AI-only states (generating/drafted/
--   insufficient_evidence) exist now so W5 adds transitions, not columns.
--   Self-approval by a human author is ALLOWED (owner decision 2026-09-02,
--   feeds D010 final resolution due W6) — the W5 gate "AI never approves" is
--   enforced separately in the AI path.
-- * questions.status is DENORMALIZED from answers.status and maintained by a
--   trigger, so the data table can filter/paginate on it without a join while
--   answers stays the single source of truth. A question with no answer row
--   reads 'empty'.
-- * D012 (owner decision 2026-09-02): export follows the CONSCIOUS BLANKS
--   rule — every question must be approved or explicitly blank_by_choice
--   before it is exportable; unapproved text is never written to an export.
--   `questions.blank_by_choice` is the explicit marker (bulk-toggleable RPC).
-- * Editing the text of an APPROVED answer invalidates that approval: the RPC
--   demotes the answer to `answered` and clears approved_by/at, with an audit
--   event. Approval must always refer to the text it approved.
-- * The answer state machine lives in a BEFORE UPDATE trigger (W4 transition
--   set; same-status text edits always allowed). W5 replaces the function to
--   add the AI-path transitions — forward-only, additive.
-- * Optimistic concurrency for autosave: answers.revision increments on every
--   RPC write; clients send the revision they loaded. A mismatch raises
--   ANSWER_CONFLICT (HTTP-safe code) instead of silently overwriting a
--   concurrent edit.
-- * questions/questionnaire_files/answers are written ONLY through SECURITY
--   DEFINER RPCs (or cascade deletes) — no direct INSERT/UPDATE policies —
--   so coordinates, revisions, and status can never drift from the rules
--   above, exactly like knowledge_entry_versions in 0003.
-- * Storage is a single PRIVATE bucket `questionnaires`. Keys are built
--   server-side as {org}/{questionnaire}/{file}/{filename}; policies re-derive
--   the org from the FIRST path segment via private.storage_org_of (0003).
-- * questionnaires_sheet data search: questions.search_vector is a generated
--   tsvector over the normalized question text (same pattern as 0003).
-- * Audit: the questionnaire lifecycle is trigger-audited; import, assignment,
--   blank-by-choice, and answer status transitions are audited by the RPCs
--   that perform them. Per-keystroke autosave edits are deliberately NOT
--   audit events — W6 answer version history is the content trail.
-- * All rejections use stable uppercase error codes as the exception MESSAGE
--   (same convention as 0001/0003) — mapped to safe copy in the app.

-- ---------------------------------------------------------------------------
-- Enums, limits
-- ---------------------------------------------------------------------------

-- PRD §7.1: importing → mapping → active → in_review → completed → exported;
-- archived. in_review/completed/exported transitions arrive with the W5/W6
-- review workflow; the values exist now so no enum migration is needed.
create type public.questionnaire_status as enum
  ('importing', 'mapping', 'active', 'in_review', 'completed', 'exported', 'archived');

-- PRD §7.2 merged answer lifecycle (see header: D010 pre-adoption).
create type public.answer_status as enum (
  'empty', 'generating', 'drafted', 'answered', 'insufficient_evidence',
  'in_review', 'changes_requested', 'rejected', 'approved'
);

create type public.answer_creator_type as enum ('manual', 'ai');

-- Hard ceilings (plan §18-W4 workbooks; mirrors private.ingestion_limits).
-- Week 8 plan entitlements may lower these per plan, never raise them.
create table private.questionnaire_limits (
  id boolean primary key default true check (id),
  max_file_bytes integer not null default 10485760,
  max_questions integer not null default 1000,
  max_question_text integer not null default 4000,
  max_answer_text integer not null default 10000,
  max_comment_text integer not null default 2000,
  constraint questionnaire_limits_singleton check (id)
);

insert into private.questionnaire_limits (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.questionnaires (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  -- Customer/company label from the buyer's own taxonomy (plan §8; free text).
  customer text not null default '' check (char_length(customer) <= 200),
  status public.questionnaire_status not null default 'importing',
  due_date date,
  -- Reviewer assignment (plan §8). Null until someone is assigned; must be an
  -- O/A/R member — enforced by set_questionnaire_reviewer/set_question_assignee.
  assigned_reviewer uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index questionnaires_organization_status_idx
  on public.questionnaires (organization_id, status);
create index questionnaires_organization_updated_idx
  on public.questionnaires (organization_id, updated_at desc);

-- One untouched original per questionnaire (plan §9: the file is stored
-- BEFORE any parsing, and never modified afterwards — see immutability
-- trigger). Export metadata (latest export only) is updated by the export
-- path; W6 adds full export history alongside these columns.
create table public.questionnaire_files (
  id uuid primary key default gen_random_uuid(),
  questionnaire_id uuid not null unique references public.questionnaires (id) on delete cascade,
  -- Denormalized so RLS never needs a join (0003 pattern); written in the
  -- same transaction as the questionnaire row.
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- {org}/{questionnaire}/{file}/{filename}; server-built, unique.
  storage_path text not null unique check (char_length(storage_path) <= 1024),
  format text not null check (format in ('xlsx', 'csv')),
  mime_type text not null check (mime_type in (
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  )),
  byte_size integer not null check (byte_size between 1 and 10485760),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  -- 'exceljs@<version>' or 'csv@<version>'; set when the mapping is confirmed.
  parser_version text check (parser_version is null or char_length(parser_version) between 1 and 60),
  -- CSV transport metadata (plan §9: "preserve delimiter/encoding metadata
  -- where practical"): { delimiter, bom } for csv; {} for xlsx.
  metadata jsonb not null default '{}'::jsonb,
  exported_storage_path text check (char_length(exported_storage_path) <= 1024),
  exported_checksum_sha256 text check (
    exported_checksum_sha256 is null or exported_checksum_sha256 ~ '^[0-9a-f]{64}$'
  ),
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index questionnaire_files_organization_idx
  on public.questionnaire_files (organization_id);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  questionnaire_id uuid not null references public.questionnaires (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Stable display/import order (source row order across sheets).
  position integer not null check (position between 0 and 1000000),
  -- Original coordinates (plan §9: persist sheet/row/cell for round-trip).
  sheet_name text not null check (char_length(btrim(sheet_name)) between 1 and 200),
  row_number integer not null check (row_number between 1 and 1048576),
  -- A1-style refs; answer/notes cells may be absent when no column is mapped.
  question_cell text not null check (question_cell ~ '^[A-Z]{1,3}[1-9][0-9]{0,6}$'),
  answer_cell text check (answer_cell is null or answer_cell ~ '^[A-Z]{1,3}[1-9][0-9]{0,6}$'),
  notes_cell text check (notes_cell is null or notes_cell ~ '^[A-Z]{1,3}[1-9][0-9]{0,6}$'),
  -- Original cell value verbatim + normalized text for search/retrieval.
  question_original text not null check (char_length(btrim(question_original)) between 1 and 4000),
  question_normalized text not null check (char_length(btrim(question_normalized)) between 1 and 4000),
  category text not null default 'general' check (char_length(btrim(category)) between 1 and 80),
  -- Denormalized from answers.status by trigger (see header).
  status public.answer_status not null default 'empty',
  -- D012 conscious blanks: explicitly marked not-applicable (bulk toggle).
  blank_by_choice boolean not null default false,
  assignee_id uuid references auth.users (id) on delete set null,
  search_vector tsvector generated always as (to_tsvector('english', question_normalized)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Backstop against a double-import of the same cell; re-import deletes
  -- existing rows first inside the confirm transaction.
  unique (questionnaire_id, sheet_name, row_number, question_cell)
);

create index questions_questionnaire_position_idx on public.questions (questionnaire_id, position);
create index questions_organization_status_idx on public.questions (organization_id, status);
create index questions_organization_assignee_idx on public.questions (organization_id, assignee_id);
create index questions_search_idx on public.questions using gin (search_vector);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null unique references public.questions (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Current answer text. W5 adds the AI draft column + citations additively
  -- (plan §8 lists "draft/current text"; W4 only fills current).
  current_text text not null check (char_length(current_text) between 1 and 10000),
  status public.answer_status not null default 'answered',
  creator_type public.answer_creator_type not null default 'manual',
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  -- Optimistic-concurrency token for autosave (see header). Not security.
  revision integer not null default 1 check (revision between 1 and 2147483647),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index answers_organization_status_idx on public.answers (organization_id, status);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  -- Threading (plan §8): a reply must stay inside the same question; replies
  -- cascade with their parent.
  parent_id uuid references public.comments (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index comments_question_created_idx on public.comments (question_id, created_at);
create index comments_organization_idx on public.comments (organization_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.questionnaires
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.questionnaire_files
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.questions
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.answers
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.comments
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- questions.status sync (denormalized from answers — single write path)
-- ---------------------------------------------------------------------------

create or replace function private.sync_question_status()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.questions set status = 'empty' where id = old.question_id;
    return old;
  end if;
  update public.questions set status = new.status where id = new.question_id;
  return new;
end;
$$;

create trigger sync_question_status
  after insert or update or delete on public.answers
  for each row execute function private.sync_question_status();

-- ---------------------------------------------------------------------------
-- Answer state machine (PRD §7.2 manual subset — see header for W5 plan)
-- ---------------------------------------------------------------------------

create or replace function private.protect_answer_transition()
returns trigger
language plpgsql
volatile
as $$
begin
  -- Same-status updates are text/revision edits and always allowed.
  if new.status = old.status then
    return new;
  end if;

  if (old.status, new.status) in (
    ('answered', 'in_review'),          -- submit for review
    ('in_review', 'approved'),          -- approve
    ('in_review', 'changes_requested'), -- request changes
    ('in_review', 'rejected'),          -- reject
    ('changes_requested', 'in_review'), -- edit + resubmit
    ('rejected', 'answered'),           -- rewritten after rejection
    ('approved', 'answered')            -- edit invalidates approval (RPC-driven)
  ) then
    return new;
  end if;

  raise exception 'ANSWER_TRANSITION_INVALID';
end;
$$;

create trigger protect_answer_transition
  before update on public.answers
  for each row execute function private.protect_answer_transition();

-- ---------------------------------------------------------------------------
-- questionnaire_files immutability (original file is append-only history)
-- ---------------------------------------------------------------------------

create or replace function private.protect_questionnaire_file_content()
returns trigger
language plpgsql
volatile
as $$
begin
  if new.questionnaire_id is distinct from old.questionnaire_id
     or new.organization_id is distinct from old.organization_id
     or new.storage_path is distinct from old.storage_path
     or new.format is distinct from old.format
     or new.mime_type is distinct from old.mime_type
     or new.byte_size is distinct from old.byte_size
     or new.checksum_sha256 is distinct from old.checksum_sha256
     or new.metadata is distinct from old.metadata
  then
    raise exception 'FILE_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger protect_questionnaire_file_content
  before update on public.questionnaire_files
  for each row execute function private.protect_questionnaire_file_content();

-- ---------------------------------------------------------------------------
-- Audit trigger: questionnaire lifecycle (metadata = state transitions only)
-- ---------------------------------------------------------------------------

create or replace function private.audit_questionnaire_lifecycle()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.organization_id, auth.uid(), 'questionnaire.created', 'questionnaire', new.id,
            jsonb_build_object('status', new.status::text));
    return new;
  end if;

  if tg_op = 'UPDATE' then
    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.organization_id, auth.uid(), 'questionnaire.updated', 'questionnaire', new.id,
            jsonb_build_object('from', old.status::text, 'to', new.status::text));
    return new;
  end if;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (old.organization_id, auth.uid(), 'questionnaire.deleted', 'questionnaire', old.id,
          jsonb_build_object('from', old.status::text));
  return old;
end;
$$;

create trigger audit_questionnaire_lifecycle
  after insert or update or delete on public.questionnaires
  for each row execute function private.audit_questionnaire_lifecycle();

-- ---------------------------------------------------------------------------
-- Storage: private bucket + path-derived org policies (0003 pattern)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'questionnaires',
  'questionnaires',
  false,
  10485760,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- {org}/{questionnaire}/{file}/{filename} — same four-segment shape as
-- document keys, so the segment checks mirror valid_document_object_path.
create or replace function private.valid_questionnaire_object_path(p_path text)
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

create policy "questionnaires_storage_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'questionnaires'
    and private.is_org_member(private.storage_org_of(name))
  );

create policy "questionnaires_storage_insert_manager" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'questionnaires'
    and private.is_org_member(private.storage_org_of(name), array['owner', 'admin', 'reviewer']::public.app_role[])
    and private.valid_questionnaire_object_path(name)
  );

create policy "questionnaires_storage_delete_manager" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'questionnaires'
    and private.is_org_member(private.storage_org_of(name), array['owner', 'admin']::public.app_role[])
    and private.valid_questionnaire_object_path(name)
  );

-- ---------------------------------------------------------------------------
-- RPC: create questionnaire + original-file upload intent (atomic, one file)
-- ---------------------------------------------------------------------------

create or replace function public.create_questionnaire_upload(
  p_organization_id uuid,
  p_title text,
  p_customer text,
  p_due_date date,
  p_filename text,
  p_mime_type text,
  p_byte_size integer,
  p_checksum_sha256 text
)
returns table (questionnaire_id uuid, file_id uuid, storage_path text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limits private.questionnaire_limits%rowtype;
  v_questionnaire_id uuid;
  v_file_id uuid;
  v_filename text := btrim(coalesce(p_filename, ''));
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_limits from private.questionnaire_limits where id = true;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  if not exists (select 1 from public.organizations o where o.id = p_organization_id and o.status = 'active') then
    raise exception 'ORG_INACTIVE';
  end if;

  if p_title is null or char_length(btrim(p_title)) not between 1 and 200
     or p_customer is null or char_length(p_customer) > 200
  then
    raise exception 'QUESTIONNAIRE_INPUT_INVALID';
  end if;

  if v_filename !~ '^[^[:cntrl:]\\]{1,200}$' or v_filename in ('.', '..') then
    raise exception 'QUESTIONNAIRE_INPUT_INVALID';
  end if;

  if p_mime_type not in (
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ) then
    raise exception 'QUESTIONNAIRE_TYPE_UNSUPPORTED';
  end if;

  if p_byte_size is null or p_byte_size < 1 then
    raise exception 'QUESTIONNAIRE_EMPTY';
  end if;
  if p_byte_size > v_limits.max_file_bytes then
    raise exception 'QUESTIONNAIRE_TOO_LARGE';
  end if;

  if p_checksum_sha256 is null or p_checksum_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'QUESTIONNAIRE_INPUT_INVALID';
  end if;

  insert into public.questionnaires (organization_id, title, customer, due_date, created_by)
  values (p_organization_id, btrim(p_title), coalesce(p_customer, ''), p_due_date, v_user_id)
  returning id into v_questionnaire_id;

  v_file_id := gen_random_uuid();

  insert into public.questionnaire_files (
    id, questionnaire_id, organization_id, storage_path, format, mime_type,
    byte_size, checksum_sha256, metadata
  ) values (
    v_file_id, v_questionnaire_id, p_organization_id,
    p_organization_id::text || '/' || v_questionnaire_id::text || '/' || v_file_id::text || '/' || v_filename,
    case when p_mime_type = 'text/csv' then 'csv' else 'xlsx' end,
    p_mime_type, p_byte_size, p_checksum_sha256, '{}'::jsonb
  );

  return query select v_questionnaire_id, v_file_id,
    p_organization_id::text || '/' || v_questionnaire_id::text || '/' || v_file_id::text || '/' || v_filename;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: importing → mapping (file parsed, mapping screen reached)
-- ---------------------------------------------------------------------------

create or replace function public.mark_questionnaire_mapping(
  p_organization_id uuid,
  p_questionnaire_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status public.questionnaire_status;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status
  from public.questionnaires
  where id = p_questionnaire_id and organization_id = p_organization_id;

  -- Same answer for unknown ids and ids outside this org (no existence leak).
  if v_status is null then
    raise exception 'QUESTIONNAIRE_NOT_FOUND';
  end if;

  -- One-way latch: importing → mapping only (never back).
  if v_status <> 'importing' then
    raise exception 'QUESTIONNAIRE_STATE_INVALID';
  end if;

  update public.questionnaires set status = 'mapping' where id = p_questionnaire_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: confirm mapping — replace-then-insert questions, mapping → active
-- ---------------------------------------------------------------------------

create or replace function public.confirm_questionnaire_mapping(
  p_organization_id uuid,
  p_questionnaire_id uuid,
  p_questions jsonb,
  p_parser_version text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limits private.questionnaire_limits%rowtype;
  v_status public.questionnaire_status;
  v_question jsonb;
  v_count integer;
  v_total integer;
  v_position integer := 0;
  v_category text;
  v_sheet_name text;
  v_row_number integer;
  v_question_cell text;
  v_answer_cell text;
  v_notes_cell text;
  v_question_original text;
  v_question_normalized text;
  v_cell_re text := '^[A-Z]{1,3}[1-9][0-9]{0,6}$';
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_limits from private.questionnaire_limits where id = true;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status
  from public.questionnaires
  where id = p_questionnaire_id and organization_id = p_organization_id;

  if v_status is null then
    raise exception 'QUESTIONNAIRE_NOT_FOUND';
  end if;

  -- Re-import is a recovery path BEFORE activation only (see header).
  if v_status not in ('importing', 'mapping') then
    raise exception 'QUESTIONNAIRE_STATE_INVALID';
  end if;

  if jsonb_typeof(p_questions) <> 'array'
     or jsonb_array_length(p_questions) < 1
     or jsonb_array_length(p_questions) > v_limits.max_questions
  then
    raise exception 'MAPPING_INPUT_INVALID';
  end if;

  if p_parser_version is null or char_length(p_parser_version) not between 1 and 60
     or p_parser_version !~ '^[A-Za-z0-9@._-]+$'
  then
    raise exception 'MAPPING_INPUT_INVALID';
  end if;

  v_total := jsonb_array_length(p_questions);

  -- Idempotent (re)import: previous partial rows go first, same transaction.
  delete from public.questions where questionnaire_id = p_questionnaire_id;

  for v_i in 0 .. v_total - 1 loop
    v_question := p_questions -> v_i;

    -- Element shape is validated field-by-field; anything malformed rejects
    -- the WHOLE import (never a partial questionnaire).
    if jsonb_typeof(v_question) <> 'object' then
      raise exception 'MAPPING_INPUT_INVALID';
    end if;

    v_category := coalesce(nullif(btrim(v_question ->> 'category'), ''), 'general');
    v_sheet_name := btrim(v_question ->> 'sheet_name');
    v_question_cell := btrim(v_question ->> 'question_cell');
    -- Empty string and missing both normalize to NULL (optional cells).
    v_answer_cell := nullif(btrim(v_question ->> 'answer_cell'), '');
    v_notes_cell := nullif(btrim(v_question ->> 'notes_cell'), '');
    v_question_original := btrim(v_question ->> 'question_original');
    v_question_normalized := btrim(v_question ->> 'question_normalized');

    if v_sheet_name is null or char_length(v_sheet_name) not between 1 and 200
       or (v_question ->> 'row_number') is null
       or (v_question ->> 'row_number') !~ '^[0-9]{1,7}$'
       or v_question_cell is null or v_question_cell !~ v_cell_re
       or (v_answer_cell is not null and v_answer_cell !~ v_cell_re)
       or (v_notes_cell is not null and v_notes_cell !~ v_cell_re)
       or char_length(v_question_original) not between 1 and v_limits.max_question_text
       or char_length(v_question_normalized) not between 1 and v_limits.max_question_text
       or char_length(v_category) > 80
    then
      raise exception 'MAPPING_INPUT_INVALID';
    end if;

    -- Guarded by the digit-only regex above; still the only cast in the loop.
    v_row_number := (v_question ->> 'row_number')::integer;
    if v_row_number not between 1 and 1048576 then
      raise exception 'MAPPING_INPUT_INVALID';
    end if;

    insert into public.questions (
      questionnaire_id, organization_id, position, sheet_name, row_number,
      question_cell, answer_cell, notes_cell,
      question_original, question_normalized, category
    ) values (
      p_questionnaire_id, p_organization_id, v_position, v_sheet_name, v_row_number,
      v_question_cell, v_answer_cell, v_notes_cell,
      v_question_original, v_question_normalized, v_category
    );

    v_position := v_position + 1;
  end loop;

  update public.questionnaire_files
  set parser_version = p_parser_version
  where questionnaire_id = p_questionnaire_id;

  update public.questionnaires
  set status = 'active'
  where id = p_questionnaire_id;

  v_count := v_total;
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, v_user_id, 'questionnaire.imported', 'questionnaire', p_questionnaire_id,
          jsonb_build_object('questions', v_count));

  return v_count;
exception
  when unique_violation then
    raise exception 'MAPPING_DUPLICATE_CELL';
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: manual answer save (autosave, revision-guarded)
-- ---------------------------------------------------------------------------

create or replace function public.save_answer(
  p_organization_id uuid,
  p_question_id uuid,
  p_text text,
  p_expected_revision integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limits private.questionnaire_limits%rowtype;
  v_questionnaire_id uuid;
  v_questionnaire_status public.questionnaire_status;
  v_answer public.answers%rowtype;
  v_clears_approval boolean := false;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_limits from private.questionnaire_limits where id = true;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  if p_text is null or char_length(btrim(p_text)) not between 1 and v_limits.max_answer_text then
    raise exception 'ANSWER_INPUT_INVALID';
  end if;

  select q.questionnaire_id, qn.status
    into v_questionnaire_id, v_questionnaire_status
  from public.questions q
  join public.questionnaires qn on qn.id = q.questionnaire_id
  where q.id = p_question_id and q.organization_id = p_organization_id;

  -- Same answer for unknown ids and ids outside this org (no existence leak).
  if v_questionnaire_id is null then
    raise exception 'QUESTION_NOT_FOUND';
  end if;

  -- Import/mapping/archived/exported questionnaires are not editable here.
  if v_questionnaire_status not in ('active', 'in_review', 'completed') then
    raise exception 'QUESTIONNAIRE_STATE_INVALID';
  end if;

  select * into v_answer from public.answers where question_id = p_question_id;

  if v_answer.id is null then
    -- First save. A stale client that already saw a row always sends a
    -- revision, so a NULL expectation here can only be a genuine create.
    if p_expected_revision is not null then
      raise exception 'ANSWER_CONFLICT';
    end if;

    insert into public.answers (question_id, organization_id, current_text, status, creator_type, created_by)
    values (p_question_id, p_organization_id, btrim(p_text), 'answered', 'manual', v_user_id);

    return 1;
  end if;

  if p_expected_revision is null or p_expected_revision <> v_answer.revision then
    raise exception 'ANSWER_CONFLICT';
  end if;

  -- Editing an APPROVED answer invalidates that approval (see header).
  v_clears_approval := v_answer.status = 'approved';

  update public.answers
  set current_text = btrim(p_text),
      status = case when v_clears_approval then 'answered' else status end,
      creator_type = 'manual',
      -- created_by keeps the ORIGINAL author; edits are tracked by revision
      -- (and, from W6, answer version history).
      approved_by = case when v_clears_approval then null else approved_by end,
      approved_at = case when v_clears_approval then null else approved_at end,
      revision = revision + 1
  where question_id = p_question_id;

  if v_clears_approval then
    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (p_organization_id, v_user_id, 'answer.approval_cleared', 'answer', v_answer.id,
            jsonb_build_object('from', 'approved', 'to', 'answered'));
  end if;

  return v_answer.revision + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: answer status transition (submit / approve / request changes / reject)
-- ---------------------------------------------------------------------------

create or replace function public.set_answer_status(
  p_organization_id uuid,
  p_question_id uuid,
  p_status public.answer_status,
  p_expected_revision integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_questionnaire_status public.questionnaire_status;
  v_answer public.answers%rowtype;
  v_new_status public.answer_status;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  if p_status not in ('in_review', 'approved', 'changes_requested', 'rejected') then
    raise exception 'ANSWER_TRANSITION_INVALID';
  end if;

  select qn.status into v_questionnaire_status
  from public.questions q
  join public.questionnaires qn on qn.id = q.questionnaire_id
  where q.id = p_question_id and q.organization_id = p_organization_id;

  if v_questionnaire_status is null then
    raise exception 'QUESTION_NOT_FOUND';
  end if;

  if v_questionnaire_status not in ('active', 'in_review', 'completed') then
    raise exception 'QUESTIONNAIRE_STATE_INVALID';
  end if;

  select * into v_answer from public.answers where question_id = p_question_id;

  -- Transitions only apply to existing content (questions.status = 'empty'
  -- questions have no answer row to move).
  if v_answer.id is null or v_answer.status = 'empty' then
    raise exception 'ANSWER_NOT_FOUND';
  end if;

  if p_expected_revision is null or p_expected_revision <> v_answer.revision then
    raise exception 'ANSWER_CONFLICT';
  end if;

  v_new_status := p_status;

  update public.answers
  set status = v_new_status,
      approved_by = case when v_new_status = 'approved' then v_user_id else approved_by end,
      approved_at = case when v_new_status = 'approved' then now() else approved_at end,
      revision = revision + 1
  where question_id = p_question_id;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, v_user_id, 'answer.status_changed', 'answer', v_answer.id,
          jsonb_build_object('from', v_answer.status::text, 'to', v_new_status::text));

  return v_answer.revision + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: bulk assignee / blank-by-choice / category (editor data table)
-- ---------------------------------------------------------------------------

create or replace function public.set_question_assignee(
  p_organization_id uuid,
  p_question_ids uuid[],
  p_assignee_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  if p_question_ids is null or cardinality(p_question_ids) not between 1 and 1000 then
    raise exception 'QUESTION_INPUT_INVALID';
  end if;

  -- Assignments go to working members only (plan §8: assignee = reviewer
  -- workflow); viewers cannot own questions.
  if p_assignee_id is not null and not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = p_assignee_id
      and m.role in ('owner', 'admin', 'reviewer')
  ) then
    raise exception 'ASSIGNEE_INVALID';
  end if;

  update public.questions
  set assignee_id = p_assignee_id
  where id = any (p_question_ids)
    and organization_id = p_organization_id;

  get diagnostics v_updated = row_count;

  -- Atomic all-or-nothing: a partial match means at least one id was
  -- cross-tenant or unknown, and the whole batch is rejected.
  if v_updated <> cardinality(p_question_ids) then
    raise exception 'QUESTION_NOT_FOUND';
  end if;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, metadata)
  values (p_organization_id, v_user_id, 'question.assignee_set', 'question',
          jsonb_build_object('count', v_updated, 'assigned', p_assignee_id is not null));

  return v_updated;
end;
$$;

create or replace function public.set_question_blank_by_choice(
  p_organization_id uuid,
  p_question_ids uuid[],
  p_value boolean
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  if p_question_ids is null or cardinality(p_question_ids) not between 1 and 1000
     or p_value is null
  then
    raise exception 'QUESTION_INPUT_INVALID';
  end if;

  update public.questions
  set blank_by_choice = p_value
  where id = any (p_question_ids)
    and organization_id = p_organization_id;

  get diagnostics v_updated = row_count;

  if v_updated <> cardinality(p_question_ids) then
    raise exception 'QUESTION_NOT_FOUND';
  end if;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, metadata)
  values (p_organization_id, v_user_id, 'question.blank_by_choice_set', 'question',
          jsonb_build_object('count', v_updated, 'value', p_value));

  return v_updated;
end;
$$;

create or replace function public.update_question_category(
  p_organization_id uuid,
  p_question_id uuid,
  p_category text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  if p_category is null or char_length(btrim(p_category)) not between 1 and 80 then
    raise exception 'QUESTION_INPUT_INVALID';
  end if;

  update public.questions
  set category = btrim(p_category)
  where id = p_question_id
    and organization_id = p_organization_id;

  if not found then
    raise exception 'QUESTION_NOT_FOUND';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock down function privileges (functions are EXECUTE-to-PUBLIC by default)
-- ---------------------------------------------------------------------------

revoke all on function public.create_questionnaire_upload(uuid, text, text, date, text, text, integer, text) from public, anon;
revoke all on function public.mark_questionnaire_mapping(uuid, uuid) from public, anon;
revoke all on function public.confirm_questionnaire_mapping(uuid, uuid, jsonb, text) from public, anon;
revoke all on function public.save_answer(uuid, uuid, text, integer) from public, anon;
revoke all on function public.set_answer_status(uuid, uuid, public.answer_status, integer) from public, anon;
revoke all on function public.set_question_assignee(uuid, uuid[], uuid) from public, anon;
revoke all on function public.set_question_blank_by_choice(uuid, uuid[], boolean) from public, anon;
revoke all on function public.update_question_category(uuid, uuid, text) from public, anon;
grant execute on function public.create_questionnaire_upload(uuid, text, text, date, text, text, integer, text) to authenticated;
grant execute on function public.mark_questionnaire_mapping(uuid, uuid) to authenticated;
grant execute on function public.confirm_questionnaire_mapping(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.save_answer(uuid, uuid, text, integer) to authenticated;
grant execute on function public.set_answer_status(uuid, uuid, public.answer_status, integer) to authenticated;
grant execute on function public.set_question_assignee(uuid, uuid[], uuid) to authenticated;
grant execute on function public.set_question_blank_by_choice(uuid, uuid[], boolean) to authenticated;
grant execute on function public.update_question_category(uuid, uuid, text) to authenticated;

revoke all on function private.valid_questionnaire_object_path(text) from public, anon;
revoke all on function private.sync_question_status() from public, anon;
revoke all on function private.protect_answer_transition() from public, anon;
revoke all on function private.protect_questionnaire_file_content() from public, anon;
revoke all on function private.audit_questionnaire_lifecycle() from public, anon;
grant execute on function private.valid_questionnaire_object_path(text) to authenticated;

revoke all on table private.questionnaire_limits from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS + explicit grants (revoke Supabase default privileges first)
-- ---------------------------------------------------------------------------

revoke all on public.questionnaires, public.questionnaire_files, public.questions,
              public.answers, public.comments
  from anon, authenticated;

alter table public.questionnaires enable row level security;
alter table public.questionnaire_files enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;
alter table public.comments enable row level security;

-- questionnaires -----------------------------------------------------------
-- (insert happens only via create_questionnaire_upload; status changes only
-- via mark_questionnaire_mapping/confirm_questionnaire_mapping RPCs)

grant select, delete on public.questionnaires to authenticated;
grant update (title, customer, due_date, assigned_reviewer) on public.questionnaires to authenticated;

create policy "questionnaires_select_member" on public.questionnaires
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy "questionnaires_update_member" on public.questionnaires
  for update to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]))
  with check (private.is_org_member(organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]));

create policy "questionnaires_delete_manager" on public.questionnaires
  for delete to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

-- questionnaire_files ------------------------------------------------------
-- (all writes happen via RPCs; clients read only)

grant select on public.questionnaire_files to authenticated;

create policy "questionnaire_files_select_member" on public.questionnaire_files
  for select to authenticated
  using (private.is_org_member(organization_id));

-- questions ----------------------------------------------------------------
-- (insert happens only via confirm_questionnaire_mapping; metadata/status
-- changes only via the RPC family)

grant select on public.questions to authenticated;

create policy "questions_select_member" on public.questions
  for select to authenticated
  using (private.is_org_member(organization_id));

-- answers ------------------------------------------------------------------
-- (insert/update happen only via save_answer/set_answer_status so revisions,
-- approvals, and the state machine can never be bypassed; rows die by cascade)

grant select on public.answers to authenticated;

create policy "answers_select_member" on public.answers
  for select to authenticated
  using (private.is_org_member(organization_id));

-- comments -----------------------------------------------------------------

grant select, insert, delete on public.comments to authenticated;

create policy "comments_select_member" on public.comments
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy "comments_insert_member" on public.comments
  for insert to authenticated
  with check (
    private.is_org_member(organization_id, array['owner', 'admin', 'reviewer']::public.app_role[])
    and author_id = (select auth.uid())
    and exists (
      select 1 from public.questions q
      where q.id = question_id
        and q.organization_id = organization_id
    )
    and (
      parent_id is null
      or exists (
        select 1 from public.comments p
        where p.id = parent_id
          and p.organization_id = organization_id
          and p.question_id = question_id
      )
    )
  );

create policy "comments_delete_author_or_manager" on public.comments
  for delete to authenticated
  using (
    private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[])
    or author_id = (select auth.uid())
  );
