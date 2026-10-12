-- 0004_storage_and_upload_fixes.sql — Week 3 fixes found by the integration
-- suite. Forward-only; 0003 is applied and stays untouched.
--
-- 1. Storage policy helpers must be callable by the storage service role.
--    The private `documents` bucket policies call private.is_org_member /
--    private.storage_org_of / private.valid_document_object_path. PostgREST's
--    `authenticated` role could reach them (W2 proved that path), but the
--    storage service evaluates storage.objects policies as `storage-api`,
--    which had no USAGE on the private schema — every upload died with
--    "permission denied for schema private" before a policy even ran.
--    Granted conditionally so local/alternate deployments without that exact
--    role name still apply cleanly.
--
-- 2. create_document_upload: the filename segment must also exclude `/` —
--    "../evil" slipped through the original character class and would have
--    minted a storage key with a `..` segment. The storage policy would still
--    have refused the upload (5 segments), but the RPC must never emit such a
--    path in the first place.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'storage-api') then
    execute 'grant usage on schema private to "storage-api"';
    execute 'grant execute on function private.is_org_member(uuid, public.app_role[]) to "storage-api"';
    execute 'grant execute on function private.storage_org_of(text) to "storage-api"';
    execute 'grant execute on function private.valid_document_object_path(text) to "storage-api"';
  end if;
end;
$$;

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

  -- The filename is ONE path segment: no slashes (no traversal, no extra
  -- segments), no backslashes, no control characters, not dot-relative.
  if v_filename !~ '^[^/[:cntrl:]\\]{1,200}$' or v_filename in ('.', '..') then
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
