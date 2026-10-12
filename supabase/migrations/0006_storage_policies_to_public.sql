-- 0006_storage_policies_to_public.sql — Week 3: storage policies apply to
-- PUBLIC. Forward-only.
--
-- The integration suite proved the wrapper helpers are reachable and correct
-- via PostgREST, yet member uploads still failed with "new row violates
-- row-level security policy": the policies were declared `TO authenticated`,
-- and the storage service evaluates them under its own service role, so NO
-- policy matched and RLS denied by default.
--
-- Role matching was never the security boundary here — the wrapper conditions
-- are. They parse the org from the path and answer membership through
-- auth.uid(): a caller without a valid member JWT (anonymous, service roles,
-- anyone) evaluates to FALSE on every clause. Declaring the policies TO
-- PUBLIC therefore applies them to whatever role the storage service uses,
-- without widening effective access by one row.

drop policy "documents_storage_select_member" on storage.objects;
create policy "documents_storage_select_member" on storage.objects
  for select to public
  using (
    bucket_id = 'documents'
    and public.storage_document_member_access(name)
  );

drop policy "documents_storage_insert_manager" on storage.objects;
create policy "documents_storage_insert_manager" on storage.objects
  for insert to public
  with check (
    bucket_id = 'documents'
    and public.storage_document_manager_access(name)
    and public.storage_document_path_valid(name)
  );

drop policy "documents_storage_delete_manager" on storage.objects;
create policy "documents_storage_delete_manager" on storage.objects
  for delete to public
  using (
    bucket_id = 'documents'
    and public.storage_document_manager_access(name)
    and public.storage_document_path_valid(name)
  );
