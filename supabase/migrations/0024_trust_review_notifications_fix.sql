-- 0024_trust_review_notifications_fix.sql — Week 7 fixes found by the W7
-- RLS matrix on its first run (the 0018/0020 pattern of the gate catching
-- its own bugs):
--
-- BUG 1 (P1): review_trust_access_request's grant loop iterated
--   `for v_doc in select doc from unnest(...)` and inserted the ROW VARIABLE
--   (a record) instead of its column — EVERY approval failed with
--   "column document_id is of type uuid but expression is of type record".
--   Replaced with a single set-based INSERT ... SELECT FROM unnest(...) with
--   the same ON CONFLICT (re-approve extends, never duplicates).
--
-- BUG 2 (P1): private.insert_notification's recipient check was
--   `private.is_org_member(p_organization_id)` — the CALLER's membership.
--   For the anonymous access-request submission (auth.uid() is null) that is
--   always false, so owner/admin notifications silently never fired. The
--   check is now the RECIPIENT's membership — which was always the stated
--   intent ("departed members must not accumulate notifications") and is
--   equivalent for every W6 member-caller path.

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

  -- Departed members must not accumulate notifications for this org. The
  -- RECIPIENT's membership is what matters — the submitter of an anonymous
  -- access request is not (and cannot be) a member.
  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
  ) then
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

revoke all on function private.insert_notification(uuid, uuid, text, text, uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- BUG 1: set-based grant creation
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
  v_count integer := 0;
  v_token text;
  v_hash text;
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

  -- One grant per document with its own expiry (J9 step 3), set-based:
  -- re-approval extends the expiry, never duplicates a row.
  insert into public.document_access_grants (
    organization_id, access_request_id, document_id, expires_at, granted_by
  )
  select
    v_request.organization_id,
    v_request.id,
    doc,
    now() + make_interval(days => p_grant_days),
    v_actor
  from unnest(p_document_ids) as t(doc)
  on conflict (access_request_id, document_id) do update set
    state = 'active',
    expires_at = excluded.expires_at,
    granted_by = excluded.granted_by;

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
