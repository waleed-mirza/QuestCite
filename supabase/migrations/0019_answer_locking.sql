-- 0019_answer_locking.sql — Week 6: serialize concurrent answer writers.
--
-- Found by the W6 simultaneous approval/edit race test (plan §W6 "simultaneous
-- approval/edit race tests"): save_answer and set_answer_status read the
-- answer row WITHOUT a row lock, so under READ COMMITTED two concurrent
-- writers could both pass the p_expected_revision check against the same
-- snapshot and both apply — an autosave edit could land on top of an approval
-- (or vice versa) with both calls reporting success. accept_answer_draft and
-- complete_answer_run_item already take FOR UPDATE (0014); this migration
-- brings the two manual paths in line. Nothing else changes: the bodies are
-- byte-identical to 0014 except for the two FOR UPDATE clauses. Forward-only;
-- never edit after applying.

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

  -- FOR UPDATE: a concurrent save/approve serializes here instead of passing
  -- the revision check against the same snapshot (see file header).
  select * into v_answer from public.answers where question_id = p_question_id for update;

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
      -- (and answer version history, 0018).
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

  -- FOR UPDATE (0019): see save_answer in this migration.
  select * into v_answer from public.answers where question_id = p_question_id for update;

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
-- Privileges (unchanged contract, re-asserted after the replacement)
-- ---------------------------------------------------------------------------

revoke all on function public.save_answer(uuid, uuid, text, integer) from public, anon;
revoke all on function public.set_answer_status(uuid, uuid, public.answer_status, integer) from public, anon;
grant execute on function public.save_answer(uuid, uuid, text, integer) to authenticated;
grant execute on function public.set_answer_status(uuid, uuid, public.answer_status, integer) to authenticated;
