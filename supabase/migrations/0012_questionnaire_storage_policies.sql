-- 0012_questionnaire_storage_policies.sql — Week 4: apply the W3 storage
-- policy invariants (0005/0006/0007) to the questionnaires bucket. Forward-only.
--
-- 0010 declared the questionnaire storage policies against the ORIGINAL 0003
-- shape: direct private-schema helper calls, TO authenticated, auth.uid()-
-- based membership. The integration suite's W3 run already proved that shape
-- dead-ends three ways on hosted storage ("permission denied for schema
-- private", no matching policy role, and auth.uid() NULL in the storage
-- service's transaction — see 0005/0006/0007 headers). This migration brings
-- the questionnaires bucket to the same final state:
--
-- * Thin SECURITY DEFINER wrappers in PUBLIC (0005 pattern) — the definer can
--   always read `private`, every role has USAGE on `public`.
-- * Policies TO PUBLIC (0006) — role matching was never the boundary; the
--   wrapper conditions are, and they evaluate FALSE for anonymous/garbage
--   JWTs on every clause.
-- * Membership resolves through private.request_user_id() (0007) — both JWT
--   claim GUCs — because auth.uid() is NULL in the storage context.
--
-- EXECUTE-on-PUBLIC safety review (default grant kept, as in 0005): each
-- wrapper is a pure function of the caller-supplied path + the caller's JWT.
-- Unknown orgs, malformed paths, and non-memberships all return FALSE — no
-- existence leak, no cross-tenant information. Underlying helpers
-- (storage_org_of, valid_questionnaire_object_path, request_user_id,
-- is_org_member_as) are SECURITY DEFINER already.
--
-- Role difference vs documents (permission matrix): questionnaire IMPORT is
-- owner/admin/reviewer, so the insert wrapper checks the O/A/R triple;
-- delete stays owner/admin; select is any membership.

-- ---------------------------------------------------------------------------
-- PUBLIC wrappers (SECURITY DEFINER, search_path locked)
-- ---------------------------------------------------------------------------

create or replace function public.storage_questionnaire_path_valid(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.valid_questionnaire_object_path(p_path);
$$;

create or replace function public.storage_questionnaire_member_access(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_member_as(private.request_user_id(), private.storage_org_of(p_path));
$$;

-- Import/uploads: owner, admin, AND reviewer (plan §4 matrix, W4).
create or replace function public.storage_questionnaire_importer_access(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_member_as(
    private.request_user_id(),
    private.storage_org_of(p_path),
    array['owner', 'admin', 'reviewer']::public.app_role[]
  );
$$;

create or replace function public.storage_questionnaire_manager_access(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_member_as(
    private.request_user_id(),
    private.storage_org_of(p_path),
    array['owner', 'admin']::public.app_role[]
  );
$$;

-- ---------------------------------------------------------------------------
-- Policies (replacing the 0010 shapes — same names, corrected mechanics)
-- ---------------------------------------------------------------------------

drop policy "questionnaires_storage_select_member" on storage.objects;
create policy "questionnaires_storage_select_member" on storage.objects
  for select to public
  using (
    bucket_id = 'questionnaires'
    and public.storage_questionnaire_member_access(name)
  );

drop policy "questionnaires_storage_insert_manager" on storage.objects;
create policy "questionnaires_storage_insert_manager" on storage.objects
  for insert to public
  with check (
    bucket_id = 'questionnaires'
    and public.storage_questionnaire_importer_access(name)
    and public.storage_questionnaire_path_valid(name)
  );

drop policy "questionnaires_storage_delete_manager" on storage.objects;
create policy "questionnaires_storage_delete_manager" on storage.objects
  for delete to public
  using (
    bucket_id = 'questionnaires'
    and public.storage_questionnaire_manager_access(name)
    and public.storage_questionnaire_path_valid(name)
  );

-- ---------------------------------------------------------------------------
-- Privileges (wrappers keep the default PUBLIC grant per the safety review;
-- re-assert the private helpers stay non-public)
-- ---------------------------------------------------------------------------

revoke all on function private.request_user_id() from public, anon;
revoke all on function private.is_org_member_as(uuid, uuid, public.app_role[]) from public, anon;
revoke all on function private.valid_questionnaire_object_path(text) from public, anon;
