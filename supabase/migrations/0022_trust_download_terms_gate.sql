-- 0022_trust_download_terms_gate.sql — Week 7 follow-up: the gated download
-- must enforce clickwrap acceptance in the DATABASE, not just the UI.
--
-- Journey J9 step 4: "Prospect accepts terms if not already recorded, then
-- downloads." Submission always records an acceptance of the terms version
-- current AT SUBMISSION TIME (0021). When the org later changes its terms,
-- that old acceptance no longer covers the current text — the download RPC
-- now requires an nda_acceptances row for THIS request matching the CURRENT
-- terms_version, else it raises TERMS_NOT_ACCEPTED. The prospect page offers
-- the clickwrap again (trust_accept_terms appends the fresh record) and the
-- download proceeds. No UI-only gate can be bypassed by hitting the route
-- directly.

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
  v_tc public.trust_centers;
  v_grant public.document_access_grants;
  v_version public.document_versions;
begin
  perform private.expire_overdue_trust_access();
  v_request := private.resolve_trust_access_request(p_slug, p_raw_token);

  select * into v_tc from public.trust_centers
  where organization_id = v_request.organization_id;

  if not exists (
    select 1 from public.nda_acceptances na
    where na.access_request_id = v_request.id
      and na.terms_version = v_tc.terms_version
  ) then
    raise exception 'TERMS_NOT_ACCEPTED';
  end if;

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
