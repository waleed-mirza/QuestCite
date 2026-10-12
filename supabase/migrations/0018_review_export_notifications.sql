-- 0018_review_export_notifications.sql — Week 6: review workflow, export
-- history, answer version history, in-app notifications.
--
-- Plan §8/§9/§18-W6 + AGENTS.md rule 7: every table ships WITH its grants and
-- RLS policies in this same migration. Forward-only; never edit after
-- applying.
--
-- Design notes (deliberate decisions):
-- * D010 FINAL RESOLUTION (closes the open decision; D022 finalized): the
--   `answer_status` enum from 0010 IS the single unified answer lifecycle —
--   manual and AI-authored content share it. `ai_disposition` (0014) stays the
--   RAW model contract stored as provenance on run items/answers; it is never
--   a second workflow state. Self-approval by a human author is ALLOWED
--   (owner decision 2026-09-02); "AI never approves" is enforced in the AI
--   write path (0014) and unchanged.
-- * ANSWER VERSION HISTORY — plan §8 "immutable history of answer edits"
--   (knowledge_entry_versions pattern from 0003). Snapshots are taken by a
--   SECURITY DEFINER trigger on answers, NOT by the calling RPCs: every text
--   write path (manual autosave, AI draft, future paths) is captured by
--   construction, and no RPC can forget. Content trail only — a version row
--   exists when (and only when) current_text changes; status transitions,
--   approvals, and draft acceptances are covered by audit_events + the
--   answers columns. Kept per-answer: newest MAX_ANSWER_VERSIONS (50), oldest
--   pruned on insert — a 1000-question workbook × 50 versions stays bounded.
-- * QUESTIONNAIRE LIFECYCLE — PRD §7.1 active → in_review → completed →
--   exported arrives via set_questionnaire_status (active↔in_review,
--   in_review→completed, completed→in_review reopen) and
--   record_questionnaire_export (completed→exported, re-export allowed from
--   exported). 'exported' freezes answers: save_answer/set_answer_status
--   already reject questionnaires outside active/in_review/completed (0010),
--   so an exported workbook's answers can never drift from the shipped file.
--   completed REQUIRES every question to be D012/D021/D023-export-eligible:
--   answered/reviewed/approved text, an AI disposition, or blank_by_choice —
--   empty/generating/drafted questions block (unreviewed AI text is never
--   declared done). The lifecycle UPDATE is audited by 0010's existing
--   audit_questionnaire_lifecycle trigger (from→to in metadata).
-- * BULK REVIEW — "where safe" (plan §W6) = strict pre-state semantics: EVERY
--   requested question must currently sit in the required source state, the
--   batch is all-or-nothing (a partial match rejects the whole call, same
--   contract as set_question_assignee), and the per-row state machine still
--   guards each write. A concurrent single edit that flips a status between
--   page load and the bulk call therefore fails the batch visibly instead of
--   approving something the reviewer did not see.
-- * EXPORT HISTORY — questionnaire_files keeps only the latest export columns
--   (0010); questionnaire_exports is the full append-only history (plan §8
--   "original and exported storage paths" + §W6 "export history, checksum").
--   Rows are written ONLY by record_questionnaire_export AFTER the service
--   has uploaded the verified workbook — the row asserts a file that exists.
--   The storage path reuses the 4-segment questionnaire object shape
--   ({org}/{questionnaire}/{export-id}/{filename}), so the 0010 path
--   validator and storage policies cover exports with zero new rules.
-- * NOTIFICATIONS — in-app events + read state (plan §8), written by
--   SECURITY DEFINER triggers so every write path is covered exactly once.
--   Targets are the people accountable for the question (assignee), the
--   answer author, and the questionnaire's assigned reviewer — always
--   EXCLUDING the actor, deduplicated, and only current org members. The
--   status trigger deliberately notifies on the HUMAN review moments
--   (in_review/changes_requested/rejected/approved) and not on every AI draft
--   or keystroke: a 250-question run must not produce 750 notifications.
--   Read state is a column-scoped UPDATE on the user's own rows; retention is
--   a per-user newest-N cap enforced at insert (MAX_NOTIFICATIONS_PER_USER).
-- * AUDIT — generation/approval/deletion already land via 0010/0014; this
--   migration adds questionnaire.exported, questionnaire.reviewer_set,
--   answer.bulk_status_changed, questionnaire.status_changed RPC audits.
--   Metadata carries ids/counts/statuses only — never answer text, document
--   content, or prompts (AGENTS rule 8).
-- * All rejections use stable uppercase error codes as the exception MESSAGE
--   (same convention as 0001/0003/0010/0014) — mapped to safe copy in app.

-- ---------------------------------------------------------------------------
-- Answer version history (content trail; trigger-written, read-only to apps)
-- ---------------------------------------------------------------------------

create table public.answer_versions (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references public.answers (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  -- Denormalized so RLS never needs a join (0003 pattern).
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- 1-based sequence per answer; newest survives the prune window.
  version_number integer not null check (version_number between 1 and 100000),
  text text not null check (char_length(text) between 1 and 10000),
  creator_type public.answer_creator_type not null,
  -- Who produced the text (null = account deleted; provenance stays).
  author_id uuid references auth.users (id) on delete set null,
  -- The answers.revision this snapshot was taken at (joins back to conflicts).
  revision integer not null check (revision between 1 and 2147483647),
  created_at timestamptz not null default now(),
  unique (answer_id, version_number)
);

create index answer_versions_organization_idx on public.answer_versions (organization_id);
create index answer_versions_question_idx on public.answer_versions (question_id);

-- Versions exist only through the trigger; nobody writes them directly.
revoke all on public.answer_versions from anon, authenticated;
grant select on public.answer_versions to authenticated;

create policy "answer_versions_select_member" on public.answer_versions
  for select to authenticated
  using (private.is_org_member(organization_id));

create or replace function private.snapshot_answer_version()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_author uuid := auth.uid();
begin
  -- Empty text = the 'insufficient_evidence' marker row (0014): no content,
  -- nothing to remember. No-change updates (status/revision-only) are not
  -- content history either.
  if new.current_text is null or new.current_text = '' then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.current_text is not distinct from old.current_text then
    return new;
  end if;

  insert into public.answer_versions (
    answer_id, question_id, organization_id, version_number,
    text, creator_type, author_id, revision
  )
  select
    new.id, new.question_id, new.organization_id,
    coalesce((select max(av.version_number) from public.answer_versions av where av.answer_id = new.id), 0) + 1,
    new.current_text, new.creator_type, coalesce(v_author, new.created_by), new.revision;

  -- Bounded history: keep the newest MAX_ANSWER_VERSIONS per answer.
  delete from public.answer_versions
  where answer_id = new.id
    and version_number <= (
      select max(av.version_number) - 50
      from public.answer_versions av
      where av.answer_id = new.id
    );

  return new;
end;
$$;

create trigger snapshot_answer_version
  after insert or update on public.answers
  for each row execute function private.snapshot_answer_version();

revoke all on function private.snapshot_answer_version() from public, anon;

-- ---------------------------------------------------------------------------
-- Notifications (in-app events + read state; trigger/RPC-written only)
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- The recipient; a user only ever sees their own rows.
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type ~ '^[a-z0-9_.]{3,60}$'),
  entity_type text not null check (entity_type in ('questionnaire', 'question', 'answer', 'comment', 'export')),
  entity_id uuid,
  -- Fast per-questionnaire cleanup/grouping without metadata parsing.
  questionnaire_id uuid references public.questionnaires (id) on delete cascade,
  -- Ids/counts/statuses only — never question/answer text (AGENTS rule 8).
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_created_idx
  on public.notifications (user_id, organization_id, created_at desc);
create index notifications_user_unread_idx
  on public.notifications (user_id) where read_at is null;
create index notifications_questionnaire_idx on public.notifications (questionnaire_id);

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "notifications_select_own" on public.notifications
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and private.is_org_member(organization_id)
  );

create policy "notifications_update_own" on public.notifications
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and private.is_org_member(organization_id)
  )
  with check (
    user_id = (select auth.uid())
    and private.is_org_member(organization_id)
  );

-- Single choke point for every notification write: skips non-members and the
-- actor themself, deduplicates recipients, prunes to the newest
-- MAX_NOTIFICATIONS_PER_USER rows per user.
create or replace function private.insert_notification(
  p_organization_id uuid,
  p_user_id uuid,
  p_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_questionnaire_id uuid,
  p_metadata jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- Null recipient (unset assignee / deleted account) is a no-op, not an error.
  if p_user_id is null or p_user_id = auth.uid() then
    return;
  end if;

  -- Departed members must not accumulate notifications for this org.
  if not private.is_org_member(p_organization_id) then
    return;
  end if;

  insert into public.notifications (
    organization_id, user_id, type, entity_type, entity_id, questionnaire_id, metadata
  ) values (
    p_organization_id, p_user_id, p_type, p_entity_type, p_entity_id, p_questionnaire_id,
    coalesce(p_metadata, '{}'::jsonb)
  );

  delete from public.notifications
  where user_id = p_user_id
    and id not in (
      select kept.id from public.notifications kept
      where kept.user_id = p_user_id
      order by kept.created_at desc, kept.id desc
      limit 500
    );
end;
$$;

revoke all on function private.insert_notification(uuid, uuid, text, text, uuid, uuid, jsonb) from public, anon;

-- Reviewer-facing targets for one question, derived once per row change.
create or replace function private.question_notification_targets(
  p_question_id uuid
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct t.user_id), '{}')
  from (
    select q.assignee_id as user_id
    from public.questions q
    where q.id = p_question_id
    union
    select a.created_by
    from public.answers a
    where a.question_id = p_question_id
    union
    select qn.assigned_reviewer
    from public.questions q
    join public.questionnaires qn on qn.id = q.questionnaire_id
    where q.id = p_question_id
  ) t
  where t.user_id is not null;
$$;

revoke all on function private.question_notification_targets(uuid) from public, anon;

-- Answer status flips notify the human review moments only (see header).
create or replace function private.notify_answer_status()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_questionnaire uuid;
  v_target uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  if new.status not in ('in_review', 'changes_requested', 'rejected', 'approved') then
    return new;
  end if;

  select q.organization_id, q.questionnaire_id
    into v_org, v_questionnaire
  from public.questions q
  where q.id = new.question_id;

  foreach v_target in array private.question_notification_targets(new.question_id) loop
    perform private.insert_notification(
      v_org, v_target,
      'answer.' || new.status::text,
      'answer', new.id, v_questionnaire,
      jsonb_build_object('question_id', new.question_id, 'from', old.status::text)
    );
  end loop;

  return new;
end;
$$;

create trigger notify_answer_status
  after update of status on public.answers
  for each row execute function private.notify_answer_status();

revoke all on function private.notify_answer_status() from public, anon;

-- New comments notify the same accountable set (minus the author).
create or replace function private.notify_comment_added()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_questionnaire uuid;
  v_target uuid;
begin
  select q.organization_id, q.questionnaire_id
    into v_org, v_questionnaire
  from public.questions q
  where q.id = new.question_id;

  foreach v_target in array private.question_notification_targets(new.question_id) loop
    perform private.insert_notification(
      v_org, v_target,
      'comment.added',
      'comment', new.id, v_questionnaire,
      jsonb_build_object('question_id', new.question_id, 'comment_author', new.author_id)
    );
  end loop;

  return new;
end;
$$;

create trigger notify_comment_added
  after insert on public.comments
  for each row execute function private.notify_comment_added();

revoke all on function private.notify_comment_added() from public, anon;

-- (Re)assignment of a question notifies the new assignee.
create or replace function private.notify_question_assigned()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is null
     or new.assignee_id is not distinct from old.assignee_id
  then
    return new;
  end if;

  perform private.insert_notification(
    new.organization_id, new.assignee_id,
    'question.assigned',
    'question', new.id, new.questionnaire_id,
    jsonb_build_object('assigned_by', auth.uid())
  );

  return new;
end;
$$;

create trigger notify_question_assigned
  after update of assignee_id on public.questions
  for each row execute function private.notify_question_assigned();

revoke all on function private.notify_question_assigned() from public, anon;

-- ---------------------------------------------------------------------------
-- Export history (append-only; rows assert an uploaded, verified workbook)
-- ---------------------------------------------------------------------------

create table public.questionnaire_exports (
  id uuid primary key,
  questionnaire_id uuid not null references public.questionnaires (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- {org}/{questionnaire}/{export-id}/{filename} — the 0010 object shape, so
  -- the existing path validator + storage policies govern exports too.
  storage_path text not null unique check (char_length(storage_path) <= 1024),
  -- Sanitized download filename (server-built, no path separators).
  filename text not null check (char_length(btrim(filename)) between 1 and 250
    and filename !~ '[/\\]' and filename not in ('.', '..')),
  format text not null check (format in ('xlsx', 'csv')),
  mime_type text not null check (mime_type in (
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  )),
  byte_size integer not null check (byte_size between 1 and 10485760),
  -- SHA-256 of the exact uploaded bytes (plan §W6: export checksum).
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  exported_by uuid references auth.users (id) on delete set null,
  -- Shape counters for the history list — no answer content (rule 8).
  question_count integer not null check (question_count between 0 and 1000000),
  approved_count integer not null check (approved_count between 0 and 1000000),
  blank_count integer not null check (blank_count between 0 and 1000000),
  written_cell_count integer not null check (written_cell_count between 0 and 1000000),
  created_at timestamptz not null default now()
);

create index questionnaire_exports_questionnaire_idx
  on public.questionnaire_exports (questionnaire_id, created_at desc);
create index questionnaire_exports_organization_idx on public.questionnaire_exports (organization_id);

revoke all on public.questionnaire_exports from anon, authenticated;
grant select on public.questionnaire_exports to authenticated;

create policy "questionnaire_exports_select_member" on public.questionnaire_exports
  for select to authenticated
  using (private.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- RPC: questionnaire reviewer assignment (plan §8 assigned_reviewer)
-- ---------------------------------------------------------------------------

create or replace function public.set_questionnaire_reviewer(
  p_organization_id uuid,
  p_questionnaire_id uuid,
  p_reviewer_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_status public.questionnaire_status;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status
  from public.questionnaires
  where id = p_questionnaire_id and organization_id = p_organization_id;

  if v_status is null then
    raise exception 'QUESTIONNAIRE_NOT_FOUND';
  end if;

  if v_status in ('archived') then
    raise exception 'QUESTIONNAIRE_STATE_INVALID';
  end if;

  -- NULL clears the assignment; otherwise the reviewer must be a working
  -- member (viewers/outsiders cannot own review, same contract as
  -- set_question_assignee).
  if p_reviewer_id is not null and not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = p_reviewer_id
      and m.role in ('owner', 'admin', 'reviewer')
  ) then
    raise exception 'ASSIGNEE_INVALID';
  end if;

  update public.questionnaires
  set assigned_reviewer = p_reviewer_id
  where id = p_questionnaire_id;

  perform private.insert_notification(
    p_organization_id, p_reviewer_id,
    'questionnaire.assigned',
    'questionnaire', p_questionnaire_id, p_questionnaire_id,
    jsonb_build_object('assigned_by', v_user_id)
  );

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, v_user_id, 'questionnaire.reviewer_set', 'questionnaire', p_questionnaire_id,
          jsonb_build_object('assigned', p_reviewer_id is not null));
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: questionnaire lifecycle transitions (PRD §7.1; exported set by export)
-- ---------------------------------------------------------------------------

create or replace function public.set_questionnaire_status(
  p_organization_id uuid,
  p_questionnaire_id uuid,
  p_status public.questionnaire_status
)
returns public.questionnaire_status
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_current public.questionnaire_status;
  v_unresolved integer;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_current
  from public.questionnaires
  where id = p_questionnaire_id and organization_id = p_organization_id;

  if v_current is null then
    raise exception 'QUESTIONNAIRE_NOT_FOUND';
  end if;

  -- D010/D012/D021/D023: completing declares every question export-eligible.
  if (v_current, p_status) not in (
    ('active', 'in_review'),      -- submit the questionnaire for review
    ('in_review', 'active'),      -- send back to drafting
    ('in_review', 'completed'),   -- review finished (eligibility-checked below)
    ('completed', 'in_review')    -- reopen
  ) then
    raise exception 'QUESTIONNAIRE_STATE_INVALID';
  end if;

  if p_status = 'completed' then
    select count(*) into v_unresolved
    from public.questions
    where questionnaire_id = p_questionnaire_id
      and organization_id = p_organization_id
      and not blank_by_choice
      and status in ('empty', 'generating', 'drafted');

    if v_unresolved > 0 then
      raise exception 'QUESTIONNAIRE_NOT_RESOLVED';
    end if;
  end if;

  update public.questionnaires
  set status = p_status
  where id = p_questionnaire_id;

  -- from→to is also captured by 0010's lifecycle audit trigger; the explicit
  -- action makes the human decision greppable in the audit list.
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, v_user_id, 'questionnaire.status_changed', 'questionnaire', p_questionnaire_id,
          jsonb_build_object('from', v_current::text, 'to', p_status::text));

  return p_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: bulk review (plan §W6 "bulk review where safe") — strict pre-states,
-- all-or-nothing; the per-row state machine still guards every write.
-- ---------------------------------------------------------------------------

create or replace function public.bulk_set_answer_status(
  p_organization_id uuid,
  p_question_ids uuid[],
  p_status public.answer_status
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
  v_required public.answer_status[];
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

  -- Required source states per target ("where safe": the reviewer acts on
  -- exactly the state they saw; anything else rejects the batch).
  v_required := case p_status
    when 'in_review' then array['answered', 'drafted']::public.answer_status[]
    when 'approved' then array['in_review']::public.answer_status[]
    when 'changes_requested' then array['in_review']::public.answer_status[]
    when 'rejected' then array['in_review']::public.answer_status[]
    else null::public.answer_status[]
  end;

  if v_required is null then
    raise exception 'ANSWER_TRANSITION_INVALID';
  end if;

  -- Lock the answer rows so a concurrent status flip cannot interleave
  -- between the eligibility count and the update.
  perform 1
  from public.answers a
  join public.questions q on q.id = a.question_id
  where a.organization_id = p_organization_id
    and q.id = any (p_question_ids)
  for update of a;

  select count(*) into v_updated
  from public.answers a
  join public.questions q on q.id = a.question_id
  where q.id = any (p_question_ids)
    and a.organization_id = p_organization_id
    and a.status = any (v_required);

  -- All-or-nothing: a mismatch means someone moved since the list was
  -- rendered, or an id is unknown/cross-tenant — nothing is written.
  if v_updated <> cardinality(p_question_ids) then
    raise exception 'ANSWER_BULK_STATE_CHANGED';
  end if;

  update public.answers a
  set status = p_status,
      approved_by = case when p_status = 'approved' then v_user_id else a.approved_by end,
      approved_at = case when p_status = 'approved' then now() else a.approved_at end,
      revision = a.revision + 1
  from public.questions q
  where q.id = a.question_id
    and q.id = any (p_question_ids)
    and a.organization_id = p_organization_id
    and a.status = any (v_required);

  get diagnostics v_updated = row_count;

  if v_updated <> cardinality(p_question_ids) then
    raise exception 'ANSWER_BULK_STATE_CHANGED';
  end if;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, metadata)
  values (p_organization_id, v_user_id, 'answer.bulk_status_changed', 'answer',
          jsonb_build_object('count', v_updated, 'to', p_status::text));

  return v_updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: record a completed export (called AFTER the workbook is uploaded)
-- ---------------------------------------------------------------------------

create or replace function public.record_questionnaire_export(
  p_organization_id uuid,
  p_questionnaire_id uuid,
  p_export_id uuid,
  p_storage_path text,
  p_filename text,
  p_format text,
  p_mime_type text,
  p_byte_size integer,
  p_checksum_sha256 text,
  p_question_count integer,
  p_approved_count integer,
  p_blank_count integer,
  p_written_cell_count integer
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_status public.questionnaire_status;
  v_export_id uuid;
  v_target uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  if p_export_id is null then
    raise exception 'EXPORT_INPUT_INVALID';
  end if;

  select status into v_status
  from public.questionnaires
  where id = p_questionnaire_id and organization_id = p_organization_id;

  if v_status is null then
    raise exception 'QUESTIONNAIRE_NOT_FOUND';
  end if;

  -- Exports happen from a completed review; re-export stays available from
  -- exported (same answers — the freeze guarantees the same content).
  if v_status not in ('completed', 'exported') then
    raise exception 'QUESTIONNAIRE_STATE_INVALID';
  end if;

  -- The caller builds the path; it must be THIS export's object in THIS
  -- org/questionnaire (segment 3 = the row id, mirroring the 0010 shape).
  if p_storage_path is null
     or p_storage_path <> (
       p_organization_id::text || '/' || p_questionnaire_id::text || '/' || p_export_id::text || '/'
       || coalesce(p_filename, '')
     )
    or p_filename is null
    or p_filename ~ '[/\\[:cntrl:]]'
    or p_filename in ('.', '..')
    or p_format not in ('xlsx', 'csv')
    or p_mime_type not in (
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv'
    )
    or p_byte_size is null or p_byte_size not between 1 and 10485760
    or p_checksum_sha256 is null or p_checksum_sha256 !~ '^[0-9a-f]{64}$'
    or p_question_count is null or p_question_count not between 1 and 1000000
    or p_approved_count is null or p_approved_count not between 0 and 1000000
    or p_blank_count is null or p_blank_count not between 0 and 1000000
    or p_written_cell_count is null or p_written_cell_count not between 0 and 1000000
  then
    raise exception 'EXPORT_INPUT_INVALID';
  end if;

  insert into public.questionnaire_exports (
    id, questionnaire_id, organization_id, storage_path, filename, format,
    mime_type, byte_size, checksum_sha256, exported_by,
    question_count, approved_count, blank_count, written_cell_count
  ) values (
    p_export_id, p_questionnaire_id, p_organization_id, p_storage_path, p_filename,
    p_format, p_mime_type, p_byte_size, p_checksum_sha256, v_user_id,
    p_question_count, p_approved_count, p_blank_count, p_written_cell_count
  );

  if v_status = 'completed' then
    update public.questionnaires set status = 'exported' where id = p_questionnaire_id;
  end if;

  foreach v_target in array (
    select coalesce(array_agg(distinct t.user_id), '{}')
    from (
      select qn.assigned_reviewer as user_id from public.questionnaires qn where qn.id = p_questionnaire_id
      union
      select qn.created_by from public.questionnaires qn where qn.id = p_questionnaire_id
    ) t
    where t.user_id is not null
  ) loop
    perform private.insert_notification(
      p_organization_id, v_target,
      'questionnaire.exported',
      'export', p_export_id, p_questionnaire_id,
      jsonb_build_object('export_id', p_export_id, 'question_count', p_question_count)
    );
  end loop;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, v_user_id, 'questionnaire.exported', 'export', p_export_id,
          jsonb_build_object(
            'questionnaire_id', p_questionnaire_id,
            'format', p_format,
            'byte_size', p_byte_size,
            'question_count', p_question_count,
            'approved_count', p_approved_count,
            'blank_count', p_blank_count
          ));

  return p_export_id;
exception
  when unique_violation then
    raise exception 'EXPORT_DUPLICATE';
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock down function privileges (functions are EXECUTE-to-PUBLIC by default)
-- ---------------------------------------------------------------------------

revoke all on function public.set_questionnaire_reviewer(uuid, uuid, uuid) from public, anon;
revoke all on function public.set_questionnaire_status(uuid, uuid, public.questionnaire_status) from public, anon;
revoke all on function public.bulk_set_answer_status(uuid, uuid[], public.answer_status) from public, anon;
revoke all on function public.record_questionnaire_export(uuid, uuid, uuid, text, text, text, text, integer, text, integer, integer, integer, integer) from public, anon;
grant execute on function public.set_questionnaire_reviewer(uuid, uuid, uuid) to authenticated;
grant execute on function public.set_questionnaire_status(uuid, uuid, public.questionnaire_status) to authenticated;
grant execute on function public.bulk_set_answer_status(uuid, uuid[], public.answer_status) to authenticated;
grant execute on function public.record_questionnaire_export(uuid, uuid, uuid, text, text, text, text, integer, text, integer, integer, integer, integer) to authenticated;
