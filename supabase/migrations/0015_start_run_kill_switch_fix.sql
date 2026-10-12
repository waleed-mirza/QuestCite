-- 0015_start_run_kill_switch_fix.sql — Week 5 forward-only fix.
--
-- start_answer_run (0014) read the per-org kill switch from the wrong table:
-- `qn.ai_drafts_disabled` resolved against questionnaires, but the column
-- lives on organizations (0014). plpgsql resolves column references at first
-- EXECUTION, not at CREATE time, so every start call failed with
-- "column qn.ai_drafts_disabled does not exist" — caught by the new
-- rls.ai-runs.test.ts suite before anything shipped.
--
-- Fix: join organizations (which also locks the org row the switch is read
-- from). Two further runtime defects surfaced by the same suite are fixed in
-- the same replacement:
-- * claim_answer_run_items' data-modifying CTE exposed its RETURNING columns
--   under their expression names (id / question_id), not the RETURNS TABLE
--   names — aliased explicitly.
-- * the idempotent-replay branches referenced answer_run_items.run_id
--   unqualified, which is AMBIGUOUS against the RETURNS TABLE out-parameter
--   of the same name ("column reference run_id is ambiguous") — aliased; and
--   count(*) (bigint) leaked into the integer skipped_count out-parameter.
--
-- complete_answer_run_item (0014) is also replaced here, for two runtime
-- defects the suite caught:
-- * the duplicate-source check compared text = uuid[] (no such operator);
-- * the finalization CASE assigned untyped literals through a text-typed
--   CASE result into the answer_run_status enum column.

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
  -- that depends on run state (see 0014 header: no duplicate-run race). The
  -- org row is locked too — it owns ai_drafts_disabled.
  select qn.status, o.ai_drafts_disabled
    into v_status, v_kill_switch
  from public.questionnaires qn
  join public.organizations o on o.id = qn.organization_id
  where qn.id = p_questionnaire_id and qn.organization_id = p_organization_id
  for update of qn, o;

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
  -- (answer_run_items is aliased: an unqualified run_id here would collide
  -- with this function's run_id OUT parameter. RETURN QUERY queues results
  -- but does NOT exit the function — the bare RETURN below is what stops
  -- execution before the one-active-run check, which would otherwise raise
  -- RUN_ALREADY_ACTIVE and discard the queued replay row.)
  if p_idempotency_key is not null then
    select id into v_existing from public.answer_runs
    where questionnaire_id = p_questionnaire_id and idempotency_key = p_idempotency_key;
    if v_existing is not null then
      return query select v_existing, false,
        (select count(*) from public.answer_run_items ari where ari.run_id = v_existing)::integer,
        greatest(v_total_questions
          - (select count(*) from public.answer_run_items ari2 where ari2.run_id = v_existing), 0)::integer;
      return;
    end if;
  end if;

  -- Exactly one live run per questionnaire (plan §11 resumability).
  if exists (
    select 1 from public.answer_runs
    where questionnaire_id = p_questionnaire_id and status in ('pending', 'running')
  ) then
    raise exception 'RUN_ALREADY_ACTIVE';
  end if;

  -- Eligibility (D024): never target approved / in-review / reserved-state /
  -- blank-by-choice questions.
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
          (select count(*) from public.answer_run_items ari where ari.run_id = v_existing)::integer,
          0;
        return;
      end if;
    end if;
    raise exception 'RUN_START_RACE';
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_answer_run_items — fixed CTE aliases (see header)
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
    returning i.id as item_id, i.question_id as question_id
  )
  select u.item_id, u.question_id, q.question_original, q.question_normalized, q.category
  from updated u
  join public.questions q on q.id = u.question_id
  order by q.position;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges re-asserted (create or replace preserves grants; this
-- keeps the lockdown explicit in the same migration that touched the body)
-- ---------------------------------------------------------------------------

revoke all on function public.start_answer_run(uuid, uuid, text, text, uuid[], text) from public, anon;
grant execute on function public.start_answer_run(uuid, uuid, text, text, uuid[], text) to authenticated;

revoke all on function public.claim_answer_run_items(uuid, uuid, integer) from public, anon;
grant execute on function public.claim_answer_run_items(uuid, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- complete_answer_run_item — fixed duplicate-source check + finalization enum
-- casts (see header). Body otherwise identical to 0014.
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

    -- Element-by-element citation validation (see 0014 header: THE
    -- cross-tenant gate lives here, in the DB). Any malformed or out-of-org
    -- element rejects the WHOLE completion.
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
      -- (uuid cast required: text = uuid[] has no operator.)
      if v_source_id::uuid = any (v_seen_sources) then
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
    set status = case
          when v_final_status = 'cancelled' then 'cancelled'::public.answer_run_status
          else 'completed'::public.answer_run_status
        end,
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

revoke all on function public.complete_answer_run_item(uuid, uuid, uuid, public.ai_disposition, text, text, public.evidence_strength, jsonb, integer, integer, bigint, text) from public, anon;
grant execute on function public.complete_answer_run_item(uuid, uuid, uuid, public.ai_disposition, text, text, public.evidence_strength, jsonb, integer, integer, bigint, text) to authenticated;
