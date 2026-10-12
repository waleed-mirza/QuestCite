-- 0028_trust_document_org_guard.sql — defense in depth for Trust Center
-- document cards. RLS and column grants protect normal clients; this trigger
-- also protects service-role fixture/admin paths from creating a cross-tenant
-- document reference that could leak metadata through a public overview.

create or replace function private.enforce_trust_document_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.documents d
    where d.id = new.document_id
      and d.organization_id = new.organization_id
  ) then
    raise exception 'TRUST_DOCUMENT_ORG_MISMATCH';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_trust_document_org() from public, anon, authenticated;

create trigger trust_center_documents_org_guard
  before insert or update of organization_id, document_id
  on public.trust_center_documents
  for each row execute function private.enforce_trust_document_org();
