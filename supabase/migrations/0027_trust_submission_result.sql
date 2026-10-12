-- 0027_trust_submission_result.sql — expose the minimum server-only result
-- needed to deliver the optional email-confirmation link.
--
-- The original submit RPC remains unchanged for compatibility. This wrapper
-- returns the request id it already creates plus the center's confirmation
-- setting; it does not return prospect identity, terms, or organization data.

create or replace function public.submit_trust_access_request_result(
  p_slug text,
  p_name text,
  p_company text,
  p_email text,
  p_document_ids uuid[],
  p_accept_terms boolean,
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
  v_request_id uuid;
  v_requires_email_verification boolean;
begin
  v_request_id := public.submit_trust_access_request(
    p_slug,
    p_name,
    p_company,
    p_email,
    p_document_ids,
    p_accept_terms,
    p_ip_hash,
    p_ua_summary
  );

  select tc.require_email_verification
    into v_requires_email_verification
  from public.access_requests ar
  join public.trust_centers tc on tc.organization_id = ar.organization_id
  where ar.id = v_request_id;

  return jsonb_build_object(
    'requestId', v_request_id,
    'requiresEmailVerification', coalesce(v_requires_email_verification, false)
  );
end;
$$;

revoke all on function public.submit_trust_access_request_result(
  text, text, text, text, uuid[], boolean, text, text
) from public, anon, authenticated;
grant execute on function public.submit_trust_access_request_result(
  text, text, text, text, uuid[], boolean, text, text
) to anon, authenticated;
