-- 0029_trust_queue_read_policy.sql - protect prospect PII and download
-- history from non-managing tenant roles.
--
-- W7's queue actions are Owner/Admin-only. The original W7 read policies
-- allowed every authenticated member to select access requests, grants, NDA
-- acceptances, and download events. Keep the explicit SELECT grants for the
-- authenticated role, but make the RLS boundary match the queue permission:
-- only Owner/Admin may read these internal prospect records.

drop policy "access_requests_select_member"
  on public.access_requests;
create policy "access_requests_select_owner_admin"
  on public.access_requests
  for select to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

drop policy "document_access_grants_select_member"
  on public.document_access_grants;
create policy "document_access_grants_select_owner_admin"
  on public.document_access_grants
  for select to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

drop policy "nda_acceptances_select_member"
  on public.nda_acceptances;
create policy "nda_acceptances_select_owner_admin"
  on public.nda_acceptances
  for select to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

drop policy "download_events_select_member"
  on public.download_events;
create policy "download_events_select_owner_admin"
  on public.download_events
  for select to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));
