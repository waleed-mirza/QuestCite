-- 0013_questionnaire_upload_metadata.sql — Week 4 slice 3: persist CSV
-- transport metadata (delimiter/BOM) at upload time. Forward-only.
--
-- Plan §9: "for .csv, perform equivalent column mapping and preserve
-- delimiter/encoding metadata where practical." questionnaire_files.metadata
-- is protected by the 0010 immutability trigger (protect_questionnaire_file_content)
-- AFTER insert, and create_questionnaire_upload inserted the '{}' default —
-- so there was NO write path that could ever record how a CSV was decoded.
-- This migration adds an optional p_metadata parameter to the insert RPC.
--
-- CREATE OR REPLACE cannot add a parameter (the argument list IS the
-- identity), so the function is dropped and recreated. The body is 0011's
-- (forward-slash-safe filename class) unchanged, plus:
--
-- * p_metadata jsonb DEFAULT '{}'::jsonb — named-argument callers (the app)
--   and the 0010/0011 8-argument SQL calls remain valid.
-- * Shape validation: must be a JSON object; keys limited to
--   { delimiter, bom }; delimiter must be a 1-character string from the
--   supported set (csv.ts CSV_DELIMITERS); bom must be boolean; CSV uploads
--   MUST carry both keys, xlsx uploads MUST pass '{}'. Anything else raises
--   QUESTIONNAIRE_INPUT_INVALID — the app's Zod schema mirrors this exactly
--   (rule 6: instant feedback, database stays the backstop).
--
-- The parser version is NOT set here; confirm_questionnaire_mapping records
-- it when the mapping is confirmed (0010).

drop function if exists public.create_questionnaire_upload(
  uuid, text, text, date, text, text, integer, text
);

create function public.create_questionnaire_upload(
  p_organization_id uuid,
  p_title text,
  p_customer text,
  p_due_date date,
  p_filename text,
  p_mime_type text,
  p_byte_size integer,
  p_checksum_sha256 text,
  p_metadata jsonb default '{}'::jsonb
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
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
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

  -- Single sanitized filename segment: no control characters, backslashes,
  -- or path separators (0004 precedent, applied by 0011).
  if v_filename !~ '^[^/[:cntrl:]\\]{1,200}$' or v_filename in ('.', '..') then
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

  -- Metadata shape (see header): csv carries { delimiter, bom }, xlsx is {}.
  if jsonb_typeof(v_metadata) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(v_metadata) as k
       where k not in ('delimiter', 'bom')
     )
     or (v_metadata ? 'delimiter' and (
           jsonb_typeof(v_metadata -> 'delimiter') <> 'string'
           or char_length(v_metadata ->> 'delimiter') <> 1
           or (v_metadata ->> 'delimiter') not in (',', ';', E'\t', '|')
         ))
     or (v_metadata ? 'bom' and jsonb_typeof(v_metadata -> 'bom') <> 'boolean')
     or (
       p_mime_type = 'text/csv'
       and not (v_metadata ? 'delimiter' and v_metadata ? 'bom')
     )
     or (p_mime_type <> 'text/csv' and v_metadata <> '{}'::jsonb)
  then
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
    p_mime_type, p_byte_size, p_checksum_sha256, v_metadata
  );

  return query select v_questionnaire_id, v_file_id,
    p_organization_id::text || '/' || v_questionnaire_id::text || '/' || v_file_id::text || '/' || v_filename;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges (a drop removes them; re-assert 0011's shape)
-- ---------------------------------------------------------------------------

revoke all on function public.create_questionnaire_upload(uuid, text, text, date, text, text, integer, text, jsonb) from public, anon;
grant execute on function public.create_questionnaire_upload(uuid, text, text, date, text, text, integer, text, jsonb) to authenticated;
