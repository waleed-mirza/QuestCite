-- 0007_storage_jwt_context.sql — Week 3: JWT resolution for storage policies.
-- Forward-only.
--
-- After 0005/0006 the storage policies apply to every role and the wrapper
-- helpers are reachable, yet member uploads still evaluated FALSE. Conclusion:
-- `auth.uid()` is NULL inside the storage service's transaction — it forwards
-- the caller's JWT through a different GUC than the ones auth.uid() reads.
--
-- Fix: `private.request_user_id()` resolves the caller from BOTH known claim
-- GUCs (`request.jwt.claim.sub`, and the `request.jwt.claims` JSON used by the
-- storage service), with a safe NULL for anonymous/garbage input. Storage
-- wrappers resolve membership against that id; table policies elsewhere keep
-- using auth.uid(), which is correct in the PostgREST context.

create or replace function private.request_user_id()
returns uuid
language plpgsql
stable
as $$
declare
  v_sub text;
begin
  v_sub := nullif(current_setting('request.jwt.claim.sub', true), '');
  if v_sub is null then
    begin
      v_sub := nullif(current_setting('request.jwt.claims', true), '');
      if v_sub is not null then
        v_sub := (v_sub::jsonb ->> 'sub');
      end if;
    exception when others then
      v_sub := null;
    end;
  end if;

  if v_sub ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v_sub::uuid;
  end if;
  return null;
end;
$$;

-- Membership check for an EXPLICIT user id (unlike is_org_member, which reads
-- auth.uid() itself). SECURITY DEFINER as before — policies and their helpers
-- must never recurse through RLS on organization_members.
create or replace function private.is_org_member_as(
  p_user_id uuid,
  p_organization_id uuid,
  p_roles public.app_role[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = p_user_id
      and (p_roles is null or m.role = any (p_roles))
  );
$$;

create or replace function public.storage_document_member_access(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_member_as(private.request_user_id(), private.storage_org_of(p_path));
$$;

create or replace function public.storage_document_manager_access(p_path text)
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
