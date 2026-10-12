-- 0025_trust_token_randomness.sql — Week 7 fix #2 from the matrix's first
-- green-path run: the approval token minted via gen_random_bytes(32) failed
-- because pgcrypto lives in the `extensions` schema, which `search_path = ''`
-- (deliberately locked on every SECURITY DEFINER function) does not see.
--
-- The mint now derives its entropy from pg_catalog-only builtins: two
-- gen_random_uuid() calls (~244 random bits) hashed through the native
-- sha256() — no extension schema dependency, still far beyond unguessable
-- for a bearer token, and the storage stays hash-only (0021).

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

  -- 64-hex bearer token from pg_catalog entropy only (see header).
  v_token := encode(
    sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'utf8')),
    'hex'
  );
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
