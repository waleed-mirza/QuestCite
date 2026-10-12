-- 0014_questionnaire_ai_drafting.sql — Week 5: AI drafting runs, citations, usage.
--
-- Plan §10/§11/§18-W5 + AGENTS.md rule 7: every table ships WITH its grants
-- and RLS policies in this same migration. Forward-only; never edit after
-- applying.
--
-- Design notes (deliberate decisions — D024):
-- * DRAFT MODEL — answers keeps ONE text field (current_text). An AI draft IS
--   the current text in status 'drafted' until a human accepts ('answered')
--   or edits it (creator_type flips to 'manual'). Plan §8's "draft/current
--   text" is read as one field whose author varies, NOT two parallel columns:
--   answers rows do not exist for unanswered questions and current_text was
--   NOT NULL ≥ 1 in 0010, so a separate draft column would need empty-current
--   exceptions for 'drafted' rows too — two coupled text invariants per state
--   for no W5 product value. W6 version history is the "compare/restore"
--   story. Regeneration is bounded instead: run creation NEVER targets
--   approved, in_review, generating, or blank_by_choice questions, so an AI
--   draft can never silently replace approved or in-flight-review content.
--   If a human approves/in-reviews BETWEEN start and completion, the state
--   machine rejects the AI write (ANSWER_TRANSITION_INVALID) and the item
--   fails visibly — humans win races by design.
-- * ABSTENTION — 'insufficient_evidence' answers carry NO text and NO
--   citations (the CHECK + trigger below enforce both directions). When the
--   model abstains over a question that already has an answer row, the row is
--   left untouched — an abstention is informational and must never destroy
--   human (or prior draft) content; only the run item records it. A marker row
--   (empty text, status insufficient_evidence) is inserted only when the
--   question had no answer at all. questions.status stays single-sourced via
--   the 0010 sync trigger. The enum value 'generating' stays RESERVED — no
--   answers row is ever created or moved to it; in-flight state lives on
--   answer_run_items so answers is never a half-written draft.
-- * AI NEVER APPROVES — the W5 gate is enforced at three layers: (1) the run
--   RPC family can only write 'drafted'/'insufficient_evidence'; (2) the
--   state-machine trigger exposes NO path from any AI-written state to
--   'approved' except through the human-only set_answer_status RPC (drafted →
--   in_review/approved/changes_requested/rejected — a human approving an AI
--   draft is the product); (3) creator_type stays 'ai' + ai_run_id provenance
--   after approval, so an approved row remains auditable as AI-authored.
-- * CITATION VALIDATION LIVES IN THE DB — "cannot cite another tenant" (W5
--   gate) is enforced inside complete_answer_run_item's transaction: every
--   citation must resolve to a chunk of the org's CURRENT ready document
--   version (active doc) or an APPROVED knowledge entry OF THE SAME ORG —
--   exactly the surfaces match_org_evidence (0003/0009) can return. Storage-
--   layer truth, not app-layer trust. answer_citations.source_id is
--   polymorphic (chunk id | entry id) and therefore has no FK; the writing
--   RPC is the only write path and validates membership per element.
-- * EXCERPTS ARE NOT DUPLICATED — citations store the SHA-256 of the excerpt
--   sent to the model plus the retrieval score; the evidence drawer re-reads
--   chunk/entry content through org-scoped joins at render time. Sensitive
--   evidence text exists exactly once (in the source table).
-- * USAGE/COST — token counts and estimated cost accumulate on answer_runs
--   (plan §10: "store token usage and estimated cost for each run"). Pricing
--   is computed APP-side at completion and passed in; the DB only guards
--   non-negative magnitudes, so a pricing-table fix never needs a migration.
--   Monthly org quotas + usage_counters remain Week 8 (plan §8 billing) — W5
--   limits are the ai_limits singleton + kill switches + one-active-run guard.
-- * KILL SWITCHES — plan §10 global AND per-org: global is the AI_ENABLED env
--   checked in app code before start_answer_run; per-org is the explicit
--   organizations.ai_drafts_disabled column (owner/admin-writable via the
--   existing organizations UPDATE grant, extended here).
-- * IDEMPOTENCY — start_answer_run accepts a client idempotency key (unique
--   per questionnaire, partial unique index); a retry returns the original
--   run instead of double-consuming quota. Item claiming is transactional
--   (FOR UPDATE SKIP LOCKED) so two tabs/two resumes claim disjoint batches.
--   Run creation takes a questionnaire row lock so concurrent starts
--   serialize before the active-run check.
-- * The resumable loop (plan §11) is: start → (claim → generate → complete)*
--   → completed, driven by the browser through thin route handlers; failed
--   items use capped attempts via retry_answer_run_item; cancel_answer_run
--   stops pending work while letting in-flight results land (cost was spent).
-- * All rejections use stable uppercase error codes as the exception MESSAGE
--   (same convention as 0001/0003/0010) — mapped to safe copy in the app.
--   Provider errors NEVER reach the DB: the caller maps them to safe codes
--   (error_code column CHECK enforces ^[A-Z0-9_]{4,60}$).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Raw model contract values (plan §10). Stored verbatim on answers/run items
-- so validation tests can pin the contract end to end.
create type public.ai_disposition as enum
  ('answered', 'needs_review', 'insufficient_evidence');

-- Transparent computed label (plan §10: never a model-generated percentage).
create type public.evidence_strength as enum ('high', 'medium', 'low', 'insufficient');

create type public.answer_run_status as enum
  ('pending', 'running', 'completed', 'failed', 'cancelled');

create type public.answer_run_item_status as enum
  ('pending', 'processing', 'completed', 'failed', 'skipped');

-- ---------------------------------------------------------------------------
-- Limits (singleton, mirrors private.ingestion_limits / questionnaire_limits)
-- ---------------------------------------------------------------------------

create table private.ai_limits (
  id boolean primary key default true check (id),
  max_questions_per_run integer not null default 250,
  max_citations_per_answer integer not null default 8,
  max_attempts_per_item integer not null default 3,
  max_claim_batch integer not null default 10,
  constraint ai_limits_singleton check (id)
);

insert into private.ai_limits (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Per-organization kill switch (plan §10; global switch is AI_ENABLED env)
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column ai_drafts_disabled boolean not null default false;

-- Extend the existing column-scoped grant (0001) so owner/admin can flip it;
-- the UPDATE policy on organizations (0001) remains the authorization layer.
grant update (name, logo_url, settings, ai_drafts_disabled)
  on public.organizations to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.answer_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  questionnaire_id uuid not null references public.questionnaires (id) on delete cascade,
  -- Who started the run (audit); NULL only if the user account is deleted.
  created_by uuid references auth.users (id) on delete set null,
  -- Env-derived (OPENAI_ANSWER_MODEL / prompt version). Free-form but
  -- format-checked so run records stay truthful and greppable.
  model text not null check (model ~ '^[A-Za-z0-9._-]{1,60}$'),
  prompt_version text not null check (prompt_version ~ '^[A-Za-z0-9._-]{1,60}$'),
  status public.answer_run_status not null default 'pending',
  -- Client-supplied duplicate guard (plan §11); unique per questionnaire.
  idempotency_key text check (
    idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'
  ),
  -- Accumulated provider usage for the whole run (see header: app-side cost).
  input_tokens integer not null default 0 check (input_tokens between 0 and 100000000),
  output_tokens integer not null default 0 check (output_tokens between 0 and 100000000),
  estimated_cost_micro_usd bigint not null default 0
    check (estimated_cost_micro_usd between 0 and 1000000000000),
  -- Safe constant code only; provider/network text never stored (plan §10
  -- "safe error messages", AGENTS rule 8).
  error_code text check (
    error_code is null
    or (char_length(error_code) between 4 and 60 and error_code ~ '^[A-Z0-9_]+$')
  ),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (questionnaire_id, idempotency_key)
);

create index answer_runs_organization_created_idx
  on public.answer_runs (organization_id, created_at desc);
create index answer_runs_questionnaire_status_idx
  on public.answer_runs (questionnaire_id, status);

create table public.answer_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.answer_runs (id) on delete cascade,
  -- Denormalized so RLS never needs a join (0003 pattern).
  organization_id uuid not null references public.organizations (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  status public.answer_run_item_status not null default 'pending',
  -- Capped retries (plan §11); complete/retry RPCs enforce the ceiling.
  attempts integer not null default 0 check (attempts between 0 and 100),
  error_code text check (
    error_code is null
    or (char_length(error_code) between 4 and 60 and error_code ~ '^[A-Z0-9_]+$')
  ),
  -- Raw model outcome for completed items (drives W6 dashboards; the answers
  -- row itself folds answered/needs_review into 'drafted').
  disposition public.ai_disposition,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, question_id)
);

create index answer_run_items_run_status_idx on public.answer_run_items (run_id, status);
create index answer_run_items_organization_idx on public.answer_run_items (organization_id);
create index answer_run_items_question_idx on public.answer_run_items (question_id);

create table public.answer_citations (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references public.answers (id) on delete cascade,
  -- Denormalized for RLS (0003 pattern); set by the writing RPC only.
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- 'document_chunk' | 'knowledge_entry' (match_org_evidence source types).
  -- Polymorphic target: FK integrity is enforced by complete_answer_run_item
  -- (see header), not by the catalog.
  source_type text not null check (source_type in ('document_chunk', 'knowledge_entry')),
  source_id uuid not null,
  -- SHA-256 of the excerpt sent to the model (plan §8: excerpt hash). The
  -- drawer joins the source table for content — never stored twice.
  excerpt_sha256 text not null check (excerpt_sha256 ~ '^[0-9a-f]{64}$'),
  retrieval_score double precision not null
    check (retrieval_score >= 0 and retrieval_score <= 1),
  position integer not null check (position between 0 and 49),
  created_at timestamptz not null default now(),
  unique (answer_id, source_type, source_id),
  unique (answer_id, position)
);

create index answer_citations_organization_idx on public.answer_citations (organization_id);

-- ---------------------------------------------------------------------------
-- answers: AI provenance columns + draft-capable text constraint (additive)
-- ---------------------------------------------------------------------------

alter table public.answers
  add column ai_run_id uuid references public.answer_runs (id) on delete set null,
  add column ai_disposition public.ai_disposition,
  add column evidence_strength public.evidence_strength,
  add column review_note text check (
    review_note is null or char_length(btrim(review_note)) between 1 and 2000
  );

-- Relax 1..10000 → 0..10000: 'insufficient_evidence' rows carry NO text (see
-- header). Every RPC write path still validates ≥ 1 for text-bearing states;
-- the protect_answer_content trigger below makes the pairing authoritative.
alter table public.answers
  drop constraint answers_current_text_check,
  add constraint answers_current_text_check check (char_length(current_text) between 0 and 10000),
  add constraint answers_provenance_matches_ai check (
    (creator_type = 'ai')
    = (ai_disposition is not null)
  );

create index answers_ai_run_idx on public.answers (ai_run_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.answer_runs
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.answer_run_items
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Answer content invariant: text emptiness is a function of status alone
-- ('insufficient_evidence' ⇔ empty text). INSERT + UPDATE.
-- ---------------------------------------------------------------------------

create or replace function private.protect_answer_content()
returns trigger
language plpgsql
volatile
as $$
begin
  if (new.current_text = '') <> (new.status = 'insufficient_evidence') then
    raise exception 'ANSWER_TEXT_STATE_INVALID';
  end if;
  return new;
end;
$$;

create trigger protect_answer_content
  before insert or update on public.answers
  for each row execute function private.protect_answer_content();

-- ---------------------------------------------------------------------------
-- Answer state machine — 0014 replaces 0010's function additively (forward-
-- only). Manual pairs are preserved verbatim; the AI-era set follows.
-- ---------------------------------------------------------------------------

create or replace function private.protect_answer_transition()
returns trigger
language plpgsql
volatile
as $$
begin
  -- Same-status updates are text/revision/provenance edits and always allowed.
  if new.status = old.status then
    return new;
  end if;

  if (old.status, new.status) in (
    -- W4 manual review path (unchanged).
    ('answered', 'in_review'),          -- submit for review
    ('in_review', 'approved'),          -- approve
    ('in_review', 'changes_requested'), -- request changes
    ('in_review', 'rejected'),          -- reject
    ('changes_requested', 'in_review'), -- edit + resubmit
    ('rejected', 'answered'),           -- rewritten after rejection
    ('approved', 'answered'),           -- edit invalidates approval (RPC-driven)
    -- W5 AI drafting path. NOTE: no pair lands on 'approved' and none lands
    -- on 'generating' — approval is human-only via in_review/set_answer_status,
    -- and 'generating' stays reserved (see migration header).
    ('answered', 'drafted'),            -- AI draft replaces a working answer
    ('changes_requested', 'drafted'),   -- AI re-draft after change request
    ('rejected', 'drafted'),            -- AI re-draft after rejection
    ('drafted', 'drafted'),             -- covered by same-status rule; kept for clarity
    ('insufficient_evidence', 'drafted'),-- re-run found evidence this time
    ('drafted', 'answered'),            -- human accepts the draft
    ('drafted', 'insufficient_evidence'),-- prior draft withdrawn by abstention re-run
    ('drafted', 'in_review'),           -- submit a draft for review
    ('drafted', 'changes_requested'),   -- reviewer requests changes on a draft
    ('drafted', 'rejected'),            -- reviewer rejects a draft
    ('drafted', 'approved'),            -- human approves a draft (never the AI)
    ('insufficient_evidence', 'answered') -- human answers after abstention
  ) then
    return new;
  end if;

  raise exception 'ANSWER_TRANSITION_INVALID';
end;
$$;

-- ---------------------------------------------------------------------------
-- save_answer — 0014 replacement: human edits fold AI drafts into 'answered'
-- and clear AI provenance (text is no longer the model's).
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
  v_folds_draft boolean := false;
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

  -- Editing an APPROVED answer invalidates that approval (see 0010 header).
  v_clears_approval := v_answer.status = 'approved';
  -- A human rewrite of AI output folds the draft into a human answer: the
  -- provenance (and citations) described the MODEL's text, not this one.
  v_folds_draft := v_answer.creator_type = 'ai';

  update public.answers
  set current_text = btrim(p_text),
      status = case
        when v_clears_approval then 'answered'::public.answer_status
        when v_answer.status in ('drafted', 'insufficient_evidence')
          then 'answered'::public.answer_status
        else status
      end,
      creator_type = 'manual',
      ai_run_id = case when v_folds_draft then null else ai_run_id end,
      ai_disposition = case when v_folds_draft then null else ai_disposition end,
      evidence_strength = case when v_folds_draft then null else evidence_strength end,
      review_note = case when v_folds_draft then null else review_note end,
      -- created_by keeps the ORIGINAL author; edits are tracked by revision
      -- (and, from W6, answer version history).
      approved_by = case when v_clears_approval then null else approved_by end,
      approved_at = case when v_clears_approval then null else approved_at end,
      revision = revision + 1
  where question_id = p_question_id;

  if v_folds_draft then
    delete from public.answer_citations where answer_id = v_answer.id;
  end if;

  if v_clears_approval then
    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (p_organization_id, v_user_id, 'answer.approval_cleared', 'answer', v_answer.id,
            jsonb_build_object('from', 'approved', 'to', 'answered'));
  end if;

  return v_answer.revision + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: accept an AI draft (human-only — 'drafted' → 'answered'). The text is
-- unchanged, so AI provenance (ai_run_id/disposition/strength/citations)
-- STAYS: the accepted answer remains auditable as model-authored. Approval
-- itself is NOT granted here — that is set_answer_status's human path.
-- ---------------------------------------------------------------------------

create or replace function public.accept_answer_draft(
  p_organization_id uuid,
  p_question_id uuid,
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
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
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

  select * into v_answer from public.answers where question_id = p_question_id for update;

  if v_answer.id is null then
    raise exception 'ANSWER_NOT_FOUND';
  end if;

  if v_answer.status <> 'drafted' then
    raise exception 'ANSWER_TRANSITION_INVALID';
  end if;

  if p_expected_revision is null or p_expected_revision <> v_answer.revision then
    raise exception 'ANSWER_CONFLICT';
  end if;

  update public.answers
  set status = 'answered', revision = revision + 1
  where id = v_answer.id;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, v_user_id, 'answer.draft_accepted', 'answer', v_answer.id,
          jsonb_build_object('ai_run_id', v_answer.ai_run_id));

  return v_answer.revision + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: start a run (plan §11 step 1) — idempotent, limit- and switch-checked
-- ---------------------------------------------------------------------------

create or replace function public.start_answer_run(
  p_organization_id uuid,
  p_questionnaire_id uuid,
  p_model text,
  p_prompt_version text,
  p_question_ids uuid[] default null,
  p_idempotency_key text default null
)
returns table (run_id uuid, created boolean, requested_count integer, skipped_count integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limits private.ai_limits%rowtype;
  v_status public.questionnaire_status;
  v_kill_switch boolean;
  v_total_questions integer;
  v_eligible integer;
  v_run_id uuid;
  v_existing uuid;
  v_skipped integer;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_limits from private.ai_limits where id = true;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  -- Serialize concurrent starts on the same questionnaire BEFORE any check
  -- that depends on run state (see header: no duplicate-run race).
  select qn.status, qn.ai_drafts_disabled
    into v_status, v_kill_switch
  from public.questionnaires qn
  where qn.id = p_questionnaire_id and qn.organization_id = p_organization_id
  for update;

  -- Same answer for unknown ids and ids outside this org (no existence leak).
  if v_status is null then
    raise exception 'QUESTIONNAIRE_NOT_FOUND';
  end if;

  if v_kill_switch then
    raise exception 'AI_DISABLED_FOR_ORG';
  end if;

  select count(*) into v_total_questions
  from public.questions
  where questionnaire_id = p_questionnaire_id and organization_id = p_organization_id;

  -- Drafting edits answers: same editability window as save_answer.
  if v_status not in ('active', 'in_review', 'completed') then
    raise exception 'QUESTIONNAIRE_STATE_INVALID';
  end if;

  if p_model is null or p_model !~ '^[A-Za-z0-9._-]{1,60}$'
     or p_prompt_version is null or p_prompt_version !~ '^[A-Za-z0-9._-]{1,60}$'
  then
    raise exception 'RUN_INPUT_INVALID';
  end if;

  if p_idempotency_key is not null and p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$' then
    raise exception 'RUN_INPUT_INVALID';
  end if;

  -- Idempotent replay: the original run is returned, never a duplicate.
  if p_idempotency_key is not null then
    select id into v_existing from public.answer_runs
    where questionnaire_id = p_questionnaire_id and idempotency_key = p_idempotency_key;
    if v_existing is not null then
      return query select v_existing, false,
        (select count(*) from public.answer_run_items where run_id = v_existing)::integer,
        greatest(v_total_questions
          - (select count(*) from public.answer_run_items where run_id = v_existing), 0);
    end if;
  end if;

  -- Exactly one live run per questionnaire (plan §11 resumability: a run is
  -- either finished or the SAME run continues — never parallel runs racing
  -- on the same questions at double cost).
  if exists (
    select 1 from public.answer_runs
    where questionnaire_id = p_questionnaire_id and status in ('pending', 'running')
  ) then
    raise exception 'RUN_ALREADY_ACTIVE';
  end if;

  -- Eligibility (D024): never target approved / in-review / reserved-state /
  -- blank-by-choice questions. questions.status is the 0010-denormalized
  -- answers.status ('empty' when no answer row exists).
  if p_question_ids is not null then
    if cardinality(p_question_ids) < 1 or cardinality(p_question_ids) > v_limits.max_questions_per_run then
      raise exception 'RUN_INPUT_INVALID';
    end if;

    select count(*) into v_eligible
    from public.questions
    where id = any (p_question_ids)
      and questionnaire_id = p_questionnaire_id
      and organization_id = p_organization_id
      and not blank_by_choice
      and status not in ('approved', 'in_review', 'generating');

    -- Every explicitly requested id must be eligible: bulk runs skip, explicit
    -- selections error (silently ignoring a named question would draft an
    -- answer set the user did not ask for).
    if v_eligible <> cardinality(p_question_ids) then
      raise exception 'RUN_QUESTIONS_INELIGIBLE';
    end if;

    v_skipped := v_total_questions - v_eligible;
  else
    select count(*) into v_eligible
    from public.questions
    where questionnaire_id = p_questionnaire_id
      and organization_id = p_organization_id
      and not blank_by_choice
      and status not in ('approved', 'in_review', 'generating');

    if v_eligible = 0 then
      raise exception 'RUN_NO_QUESTIONS';
    end if;
    if v_eligible > v_limits.max_questions_per_run then
      raise exception 'RUN_TOO_LARGE';
    end if;

    v_skipped := v_total_questions - v_eligible;
  end if;

  insert into public.answer_runs (organization_id, questionnaire_id, created_by, model, prompt_version, idempotency_key)
  values (p_organization_id, p_questionnaire_id, v_user_id, p_model, p_prompt_version, p_idempotency_key)
  returning id into v_run_id;

  insert into public.answer_run_items (run_id, organization_id, question_id)
  select v_run_id, p_organization_id, q.id
  from public.questions q
  where q.questionnaire_id = p_questionnaire_id
    and q.organization_id = p_organization_id
    and not q.blank_by_choice
    and q.status not in ('approved', 'in_review', 'generating')
    and (p_question_ids is null or q.id = any (p_question_ids));

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, v_user_id, 'ai_run.started', 'answer_run', v_run_id,
          jsonb_build_object('questions', v_eligible, 'skipped', v_skipped,
                             'model', p_model, 'prompt_version', p_prompt_version));

  return query select v_run_id, true, v_eligible, v_skipped;
exception
  when unique_violation then
    -- Lost an idempotent race to a concurrent identical start.
    if p_idempotency_key is not null then
      select id into v_existing from public.answer_runs
      where questionnaire_id = p_questionnaire_id and idempotency_key = p_idempotency_key;
      if v_existing is not null then
        return query select v_existing, false,
          (select count(*) from public.answer_run_items where run_id = v_existing)::integer,
          0;
      end if;
    end if;
    raise exception 'RUN_START_RACE';
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: claim the next batch (plan §11 step 2–3) — transactional, disjoint
-- ---------------------------------------------------------------------------

create or replace function public.claim_answer_run_items(
  p_organization_id uuid,
  p_run_id uuid,
  p_batch_size integer
)
returns table (
  item_id uuid,
  question_id uuid,
  question_original text,
  question_normalized text,
  category text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limits private.ai_limits%rowtype;
  v_run public.answer_runs%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_limits from private.ai_limits where id = true;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  if p_batch_size is null or p_batch_size < 1 or p_batch_size > v_limits.max_claim_batch then
    raise exception 'RUN_INPUT_INVALID';
  end if;

  select * into v_run from public.answer_runs
  where id = p_run_id and organization_id = p_organization_id
  for update;

  -- Same answer for unknown ids and ids outside this org (no existence leak).
  if v_run.id is null then
    raise exception 'RUN_NOT_FOUND';
  end if;

  if v_run.status not in ('pending', 'running') then
    raise exception 'RUN_NOT_ACTIVE';
  end if;

  if v_run.status = 'pending' then
    update public.answer_runs set status = 'running', started_at = now()
    where id = v_run.id;
  end if;

  return query
  with claimed as (
    select c.id from public.answer_run_items c
    where c.run_id = v_run.id and c.status = 'pending'
    order by c.id
    limit p_batch_size
    for update skip locked
  ),
  updated as (
    update public.answer_run_items i
    set status = 'processing', started_at = now()
    where i.id in (select id from claimed)
    returning i.id, i.question_id
  )
  select u.item_id, u.question_id, q.question_original, q.question_normalized, q.category
  from updated u
  join public.questions q on q.id = u.question_id
  order by q.position;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: complete one claimed item (plan §11 step 3) — the W5 security core.
-- Validates the model output + every citation against in-org evidence inside
-- this transaction, writes the answer + citations, accumulates usage, and
-- finalizes the run when the last item lands.
-- ---------------------------------------------------------------------------

create or replace function public.complete_answer_run_item(
  p_organization_id uuid,
  p_run_id uuid,
  p_item_id uuid,
  p_disposition public.ai_disposition,
  p_answer_text text,
  p_review_note text,
  p_strength public.evidence_strength,
  p_citations jsonb,
  p_input_tokens integer,
  p_output_tokens integer,
  p_estimated_cost_micro_usd bigint,
  p_error_code text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limits private.ai_limits%rowtype;
  v_run public.answer_runs%rowtype;
  v_item public.answer_run_items%rowtype;
  v_question_id uuid;
  v_answer public.answers%rowtype;
  v_citation jsonb;
  v_citation_count integer;
  v_source_type text;
  v_source_id text;
  v_excerpt text;
  v_score_text text;
  v_score double precision;
  v_position_text text;
  v_position integer;
  v_seen_sources uuid[] := '{}';
  v_valid_citations integer := 0;
  v_final_status public.answer_run_status;
  v_run_input integer;
  v_run_output integer;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_limits from private.ai_limits where id = true;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_run from public.answer_runs
  where id = p_run_id and organization_id = p_organization_id
  for update;

  if v_run.id is null then
    raise exception 'RUN_NOT_FOUND';
  end if;

  select * into v_item from public.answer_run_items
  where id = p_item_id and run_id = v_run.id and organization_id = p_organization_id
  for update;

  if v_item.id is null then
    raise exception 'RUN_ITEM_NOT_FOUND';
  end if;

  -- Only the claimer's transaction window may complete an item.
  if v_item.status <> 'processing' then
    raise exception 'RUN_ITEM_NOT_CLAIMED';
  end if;

  -- Usage is recorded even for failed attempts: spent tokens are spent.
  update public.answer_runs
  set input_tokens = input_tokens + greatest(coalesce(p_input_tokens, 0), 0),
      output_tokens = output_tokens + greatest(coalesce(p_output_tokens, 0), 0),
      estimated_cost_micro_usd = estimated_cost_micro_usd + greatest(coalesce(p_estimated_cost_micro_usd, 0::bigint), 0::bigint)
  where id = v_run.id;

  -- Failure path: safe code, attempt consumed, retry stays deliberate (and
  -- capped) via retry_answer_run_item.
  if p_error_code is not null then
    if p_error_code !~ '^[A-Z0-9_]{4,60}$' or p_disposition is not null then
      raise exception 'RUN_INPUT_INVALID';
    end if;

    update public.answer_run_items
    set status = 'failed',
        attempts = attempts + 1,
        error_code = p_error_code,
        completed_at = now()
    where id = v_item.id;
  else
    -- ---------------------------------------------------------------
    -- Success path: validate the full model contract BEFORE any write.
    -- ---------------------------------------------------------------
    if p_disposition is null then
      raise exception 'RUN_INPUT_INVALID';
    end if;

    if jsonb_typeof(p_citations) <> 'array'
       or jsonb_array_length(p_citations) > v_limits.max_citations_per_answer
    then
      raise exception 'RUN_CITATIONS_INVALID';
    end if;
    v_citation_count := jsonb_array_length(p_citations);

    if p_disposition = 'insufficient_evidence' then
      -- Abstention: no text, no citations, strength 'insufficient' (D024).
      if p_answer_text is not null or v_citation_count > 0 or p_strength <> 'insufficient' then
        raise exception 'RUN_INPUT_INVALID';
      end if;
    else
      -- answered / needs_review produce a real draft with valid strength.
      if p_answer_text is null
         or char_length(btrim(p_answer_text)) not between 1 and
            (select max_answer_text from private.questionnaire_limits where id = true)
         or p_strength is null
         or p_strength not in ('high', 'medium', 'low')
      then
        raise exception 'RUN_INPUT_INVALID';
      end if;

      -- "Abstains instead of fabricating" (W5 gate): a confident answer MUST
      -- cite evidence; needs_review may carry zero citations.
      if p_disposition = 'answered' and v_citation_count = 0 then
        raise exception 'RUN_CITATIONS_INVALID';
      end if;

      if p_review_note is not null and char_length(btrim(p_review_note)) not between 1 and 2000 then
        raise exception 'RUN_INPUT_INVALID';
      end if;
    end if;

    -- Element-by-element citation validation (see header: THE cross-tenant
    -- gate lives here, in the DB). Any malformed or out-of-org element
    -- rejects the WHOLE completion.
    for v_i in 0 .. v_citation_count - 1 loop
      v_citation := p_citations -> v_i;

      if jsonb_typeof(v_citation) <> 'object' then
        raise exception 'RUN_CITATIONS_INVALID';
      end if;

      v_source_type := coalesce(v_citation ->> 'source_type', '');
      v_source_id := coalesce(v_citation ->> 'source_id', '');
      v_excerpt := coalesce(v_citation ->> 'excerpt_sha256', '');
      v_score_text := coalesce(v_citation ->> 'retrieval_score', '');
      v_position_text := coalesce(v_citation ->> 'position', '');

      if v_source_type not in ('document_chunk', 'knowledge_entry')
         or v_source_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or v_excerpt !~ '^[0-9a-f]{64}$'
         or v_score_text !~ '^[0-9]+(\.[0-9]+)?$'
         or v_position_text !~ '^[0-9]{1,2}$'
      then
        raise exception 'RUN_CITATIONS_INVALID';
      end if;

      v_score := v_score_text::double precision;
      v_position := v_position_text::integer;

      if v_score < 0 or v_score > 1 or v_position > 49 then
        raise exception 'RUN_CITATIONS_INVALID';
      end if;

      -- Same source cited twice in one answer is model confusion, not evidence.
      if v_source_id = any (v_seen_sources) then
        raise exception 'RUN_CITATIONS_INVALID';
      end if;
      v_seen_sources := v_seen_sources || v_source_id::uuid;

      if v_source_type = 'document_chunk' then
        -- Chunk of THIS org's CURRENT ready version of an ACTIVE document —
        -- the exact surface match_org_evidence (0003/0009) can return.
        if not exists (
          select 1
          from public.document_chunks c
          join public.document_versions v on v.id = c.version_id
          join public.documents d on d.id = v.document_id
          where c.id = v_source_id::uuid
            and d.organization_id = p_organization_id
            and d.state = 'active'
            and v.processing_state = 'ready'
            and v.version_number = (
              select max(cv.version_number) from public.document_versions cv
              where cv.document_id = d.id and cv.processing_state = 'ready'
            )
        ) then
          raise exception 'RUN_CITATIONS_INVALID';
        end if;
      else
        -- Approved knowledge entry OF THIS ORG (retrieval never surfaces
        -- draft/needs_review/retired entries — 0003).
        if not exists (
          select 1 from public.knowledge_entries ke
          where ke.id = v_source_id::uuid
            and ke.organization_id = p_organization_id
            and ke.review_state = 'approved'
        ) then
          raise exception 'RUN_CITATIONS_INVALID';
        end if;
      end if;

      v_valid_citations := v_valid_citations + 1;
    end loop;

    -- ---------------------------------------------------------------
    -- Writes. The state machine may still refuse (e.g. a human approved
    -- the answer between start and completion): those land as item
    -- failures with the trigger's safe code, never as raised RPC errors.
    -- ---------------------------------------------------------------
    begin
      select q.id into v_question_id
      from public.questions q
      where q.id = v_item.question_id and q.organization_id = p_organization_id;

      if v_question_id is null then
        raise exception 'QUESTION_NOT_FOUND';
      end if;

      select * into v_answer from public.answers where question_id = v_question_id for update;

      if p_disposition = 'insufficient_evidence' then
        if v_answer.id is null then
          -- Abstention marker: empty text + no citations (trigger-enforced).
          insert into public.answers (
            question_id, organization_id, current_text, status, creator_type,
            ai_run_id, ai_disposition, evidence_strength, review_note
          ) values (
            v_question_id, p_organization_id, '', 'insufficient_evidence', 'ai',
            v_run.id, 'insufficient_evidence', 'insufficient', nullif(btrim(coalesce(p_review_note, '')), '')
          );
        else
          -- Never destroy existing content with an abstention (D024): the
          -- run item alone records the outcome.
          null;
        end if;
      else
        if v_answer.id is null then
          insert into public.answers (
            question_id, organization_id, current_text, status, creator_type,
            ai_run_id, ai_disposition, evidence_strength, review_note
          ) values (
            v_question_id, p_organization_id, btrim(p_answer_text), 'drafted', 'ai',
            v_run.id, p_disposition, p_strength, nullif(btrim(coalesce(p_review_note, '')), '')
          )
          returning * into v_answer;
        else
          -- Replacing approved/in_review content is impossible BY TRIGGER —
          -- the run never targets them at start (D024) and a human who
          -- approves mid-run wins the race via ANSWER_TRANSITION_INVALID.
          update public.answers
          set current_text = btrim(p_answer_text),
              status = 'drafted',
              creator_type = 'ai',
              ai_run_id = v_run.id,
              ai_disposition = p_disposition,
              evidence_strength = p_strength,
              review_note = nullif(btrim(coalesce(p_review_note, '')), ''),
              revision = revision + 1
          where id = v_answer.id
          returning * into v_answer;

          -- Citations describe THIS draft; a re-draft replaces them.
          delete from public.answer_citations where answer_id = v_answer.id;
        end if;

        for v_i in 0 .. v_citation_count - 1 loop
          v_citation := p_citations -> v_i;
          insert into public.answer_citations (
            answer_id, organization_id, source_type, source_id,
            excerpt_sha256, retrieval_score, position
          ) values (
            v_answer.id, p_organization_id,
            v_citation ->> 'source_type',
            (v_citation ->> 'source_id')::uuid,
            v_citation ->> 'excerpt_sha256',
            (v_citation ->> 'retrieval_score')::double precision,
            (v_citation ->> 'position')::integer
          );
        end loop;
      end if;

      update public.answer_run_items
      set status = 'completed',
          attempts = attempts + 1,
          error_code = null,
          disposition = p_disposition,
          completed_at = now()
      where id = v_item.id;
    exception
      when others then
        -- State-machine refusals and write races: visible item failure with
        -- the safe code; validation/auth errors above already raised hard.
        if sqlerrm ~ '^[A-Z0-9_]{4,60}$' then
          update public.answer_run_items
          set status = 'failed',
              attempts = attempts + 1,
              error_code = sqlerrm,
              completed_at = now()
          where id = v_item.id;
        else
          raise exception 'RUN_ITEM_WRITE_FAILED';
        end if;
    end;
  end if;

  -- Finalize when nothing is in flight (idempotent under concurrency: both
  -- racers compute the same state on the run row they hold FOR UPDATE).
  select status, input_tokens, output_tokens
    into v_final_status, v_run_input, v_run_output
  from public.answer_runs where id = v_run.id;

  if v_final_status in ('pending', 'running', 'cancelled') and not exists (
    select 1 from public.answer_run_items
    where run_id = v_run.id and status in ('pending', 'processing')
  ) then
    update public.answer_runs
    set status = case when v_final_status = 'cancelled' then 'cancelled' else 'completed' end,
        completed_at = coalesce(completed_at, now())
    where id = v_run.id;

    if v_final_status <> 'cancelled' then
      insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
      values (p_organization_id, v_user_id, 'ai_run.completed', 'answer_run', v_run.id,
              jsonb_build_object(
                'completed', (select count(*) from public.answer_run_items where run_id = v_run.id and status = 'completed'),
                'failed', (select count(*) from public.answer_run_items where run_id = v_run.id and status = 'failed'),
                'skipped', (select count(*) from public.answer_run_items where run_id = v_run.id and status = 'skipped'),
                'input_tokens', v_run_input,
                'output_tokens', v_run_output
              ));
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: cancel a run (pending work → skipped; in-flight completions land)
-- ---------------------------------------------------------------------------

create or replace function public.cancel_answer_run(
  p_organization_id uuid,
  p_run_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_run public.answer_runs%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_run from public.answer_runs
  where id = p_run_id and organization_id = p_organization_id
  for update;

  if v_run.id is null then
    raise exception 'RUN_NOT_FOUND';
  end if;

  if v_run.status not in ('pending', 'running') then
    raise exception 'RUN_NOT_ACTIVE';
  end if;

  update public.answer_run_items
  set status = 'skipped', completed_at = now()
  where run_id = v_run.id and status = 'pending';

  update public.answer_runs
  set status = 'cancelled', completed_at = now()
  where id = v_run.id;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, v_user_id, 'ai_run.cancelled', 'answer_run', v_run.id,
          jsonb_build_object('from', v_run.status::text));
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: retry a failed item (capped, plan §11 step 7)
-- ---------------------------------------------------------------------------

create or replace function public.retry_answer_run_item(
  p_organization_id uuid,
  p_run_id uuid,
  p_item_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limits private.ai_limits%rowtype;
  v_run public.answer_runs%rowtype;
  v_item public.answer_run_items%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_limits from private.ai_limits where id = true;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_run from public.answer_runs
  where id = p_run_id and organization_id = p_organization_id
  for update;

  if v_run.id is null then
    raise exception 'RUN_NOT_FOUND';
  end if;

  -- Cancelled is a terminal user decision; pending/running runs retry their
  -- items through the normal loop without reopening.
  if v_run.status not in ('running', 'completed') then
    raise exception 'RUN_NOT_ACTIVE';
  end if;

  select * into v_item from public.answer_run_items
  where id = p_item_id and run_id = v_run.id and organization_id = p_organization_id
  for update;

  if v_item.id is null then
    raise exception 'RUN_ITEM_NOT_FOUND';
  end if;

  if v_item.status <> 'failed' then
    raise exception 'RUN_ITEM_NOT_FAILED';
  end if;

  if v_item.attempts >= v_limits.max_attempts_per_item then
    raise exception 'RUN_ITEM_RETRIES_EXHAUSTED';
  end if;

  update public.answer_run_items
  set status = 'pending', error_code = null, completed_at = null
  where id = v_item.id;

  -- Reopen a completed run so the loop can drive it to a new finalization.
  if v_run.status = 'completed' then
    update public.answer_runs set status = 'running', completed_at = null
    where id = v_run.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock down function privileges (functions are EXECUTE-to-PUBLIC by default)
-- ---------------------------------------------------------------------------

revoke all on function public.save_answer(uuid, uuid, text, integer) from public, anon;
revoke all on function public.accept_answer_draft(uuid, uuid, integer) from public, anon;
revoke all on function public.start_answer_run(uuid, uuid, text, text, uuid[], text) from public, anon;
revoke all on function public.claim_answer_run_items(uuid, uuid, integer) from public, anon;
revoke all on function public.complete_answer_run_item(uuid, uuid, uuid, public.ai_disposition, text, text, public.evidence_strength, jsonb, integer, integer, bigint, text) from public, anon;
revoke all on function public.cancel_answer_run(uuid, uuid) from public, anon;
revoke all on function public.retry_answer_run_item(uuid, uuid, uuid) from public, anon;
grant execute on function public.save_answer(uuid, uuid, text, integer) to authenticated;
grant execute on function public.accept_answer_draft(uuid, uuid, integer) to authenticated;
grant execute on function public.start_answer_run(uuid, uuid, text, text, uuid[], text) to authenticated;
grant execute on function public.claim_answer_run_items(uuid, uuid, integer) to authenticated;
grant execute on function public.complete_answer_run_item(uuid, uuid, uuid, public.ai_disposition, text, text, public.evidence_strength, jsonb, integer, integer, bigint, text) to authenticated;
grant execute on function public.cancel_answer_run(uuid, uuid) to authenticated;
grant execute on function public.retry_answer_run_item(uuid, uuid, uuid) to authenticated;

revoke all on function private.protect_answer_content() from public, anon;
revoke all on function private.protect_answer_transition() from public, anon;
revoke all on table private.ai_limits from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS + explicit grants (revoke Supabase default privileges first)
-- ---------------------------------------------------------------------------

revoke all on public.answer_runs, public.answer_run_items, public.answer_citations
  from anon, authenticated;

alter table public.answer_runs enable row level security;
alter table public.answer_run_items enable row level security;
alter table public.answer_citations enable row level security;

-- answer_runs ---------------------------------------------------------------
-- (all writes happen via the run RPC family; clients read only)

grant select on public.answer_runs to authenticated;

create policy "answer_runs_select_member" on public.answer_runs
  for select to authenticated
  using (private.is_org_member(organization_id));

-- answer_run_items ----------------------------------------------------------
-- (claimed/completed only via the run RPCs; clients read only)

grant select on public.answer_run_items to authenticated;

create policy "answer_run_items_select_member" on public.answer_run_items
  for select to authenticated
  using (private.is_org_member(organization_id));

-- answer_citations ----------------------------------------------------------
-- (written only inside complete_answer_run_item's validated transaction)

grant select on public.answer_citations to authenticated;

create policy "answer_citations_select_member" on public.answer_citations
  for select to authenticated
  using (private.is_org_member(organization_id));
