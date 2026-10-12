-- 0005_storage_policy_wrappers.sql — Week 3: make storage policies
-- role-independent. Forward-only.
--
-- Problem found by the integration suite: storage.objects policies call
-- private-schema helpers, and the storage service evaluates those policies as
-- a role whose exact name varies by deployment (0004's targeted grant to
-- `storage-api` did not lift "permission denied for schema private"). Guessing
-- role names is brittle; reachability must not depend on them.
--
-- Fix: thin SECURITY DEFINER wrappers in the PUBLIC schema. The definer
-- (postgres) can always read the private schema, and every role has USAGE on
-- `public`, so the policies work regardless of which role evaluates them.
--
-- EXECUTE-on-PUBLIC safety review (these wrappers keep the default grant):
-- * storage_document_path_valid — pure function of the input string.
-- * storage_document_member_access / _manager_access — answer "does the
--   CALLER belong to the org parsed from this path". The org uuid comes from
--   the path the caller supplied; unknown orgs and non-memberships return the
--   same FALSE, so no existence leak and no cross-tenant information. The
--   underlying helpers are already EXECUTE-granted to authenticated in 0003.

create or replace function public.storage_document_path_valid(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.valid_document_object_path(p_path);
$$;

create or replace function public.storage_document_member_access(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_member(private.storage_org_of(p_path));
$$;

create or replace function public.storage_document_manager_access(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_member(private.storage_org_of(p_path), array['owner', 'admin']::public.app_role[]);
$$;

drop policy "documents_storage_select_member" on storage.objects;
create policy "documents_storage_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and public.storage_document_member_access(name)
  );

drop policy "documents_storage_insert_manager" on storage.objects;
create policy "documents_storage_insert_manager" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and public.storage_document_manager_access(name)
    and public.storage_document_path_valid(name)
  );

drop policy "documents_storage_delete_manager" on storage.objects;
create policy "documents_storage_delete_manager" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and public.storage_document_manager_access(name)
    and public.storage_document_path_valid(name)
  );
