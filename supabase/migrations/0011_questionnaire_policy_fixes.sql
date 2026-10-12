-- 0011_questionnaire_policy_fixes.sql — Week 4: fix 0010 filename validation,
-- questionnaire object-path validation, and comment-thread policy scoping.
-- Forward-only.
--
-- The questionnaire integration matrix isolated three defects shipped in 0010:
--
-- * create_questionnaire_upload accepted path-traversal filenames
--   ("../evil.xlsx"): the filename class `[^[:cntrl:]\\]` excludes control
--   characters and backslashes but NOT forward slashes. Same defect 0004
--   already fixed for create_document_upload — the corrected class
--   `[^/[:cntrl:]\\]` is applied here too.
-- * private.valid_questionnaire_object_path was written against
--   `storage.foldername(name)`, which returns the object's PARENT FOLDERS
--   only (every segment EXCEPT the filename). A valid
--   {org}/{questionnaire}/{file}/{filename} key yields THREE elements, so the
--   cardinality = 4 check rejected exactly the uploads it should have allowed
--   and admitted keys with an extra segment. Same root cause 0008 fixed for
--   the documents bucket — fixed here with core `string_to_array(name, '/')`.
-- * The comments INSERT policy correlated its threading subqueries
--   unqualified: inside `select ... from comments p where p.id = parent_id`,
--   the bare `parent_id` resolved to the INNER table's column (p.parent_id),
--   making the predicate `p.id = p.parent_id` — never true — so every
--   legitimate reply was rejected with a policy violation. The questions
--   subquery had the inverse tautology (`q.organization_id = organization_id`
--   compared the chunk's org to itself). Both subqueries now reference the
--   new row with explicit `comments.` qualifiers.

-- ---------------------------------------------------------------------------
-- Fix 1: filename class excludes forward slashes (mirrors 0004)
-- ---------------------------------------------------------------------------

create or replace function public.create_questionnaire_upload(
  p_organization_id uuid,
  p_title text,
  p_customer text,
  p_due_date date,
  p_filename text,
  p_mime_type text,
  p_byte_size integer,
  p_checksum_sha256 text
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
  -- or path separators (0004 precedent).
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
    p_mime_type, p_byte_size, p_checksum_sha256, '{}'::jsonb
  );

  return query select v_questionnaire_id, v_file_id,
    p_organization_id::text || '/' || v_questionnaire_id::text || '/' || v_file_id::text || '/' || v_filename;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fix 2: object-path validation over ALL segments (mirrors 0008)
-- ---------------------------------------------------------------------------

create or replace function private.valid_questionnaire_object_path(p_path text)
returns boolean
language sql
stable
as $$
  select
    private.storage_org_of(p_path) is not null
    and cardinality(string_to_array(p_path, '/')) = 4
    and (string_to_array(p_path, '/'))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (string_to_array(p_path, '/'))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (string_to_array(p_path, '/'))[4] ~ '^[^/[:cntrl:]\\]{1,200}$'
    and (string_to_array(p_path, '/'))[4] not in ('.', '..')
$$;

-- ---------------------------------------------------------------------------
-- Fix 3: comment INSERT policy with qualified correlation names
-- ---------------------------------------------------------------------------

drop policy "comments_insert_member" on public.comments;

create policy "comments_insert_member" on public.comments
  for insert to authenticated
  with check (
    private.is_org_member(comments.organization_id, array['owner', 'admin', 'reviewer']::public.app_role[])
    and comments.author_id = (select auth.uid())
    and exists (
      select 1 from public.questions q
      where q.id = comments.question_id
        and q.organization_id = comments.organization_id
    )
    and (
      comments.parent_id is null
      or exists (
        select 1 from public.comments parent
        where parent.id = comments.parent_id
          and parent.organization_id = comments.organization_id
          and parent.question_id = comments.question_id
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Re-assert function privileges (create or replace preserves grants; kept
-- explicit so this migration is self-contained when audited)
-- ---------------------------------------------------------------------------

revoke all on function public.create_questionnaire_upload(uuid, text, text, date, text, text, integer, text) from public, anon;
revoke all on function private.valid_questionnaire_object_path(text) from public, anon;
grant execute on function public.create_questionnaire_upload(uuid, text, text, date, text, text, integer, text) to authenticated;
grant execute on function private.valid_questionnaire_object_path(text) to authenticated;
