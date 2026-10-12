-- 0026_trust_center_write_guards.sql — Week 7 write-surface hardening.
--
-- 0021 granted broad table UPDATE privileges to authenticated members. That
-- let an owner/admin bypass set_trust_center_status's publish-readiness gate
-- by updating status directly, and let a member point a Trust Center card at
-- another tenant's document. Narrow the grants and make slug changes an
-- audited RPC.

-- Trust Center lifecycle fields are RPC-only. Branding and terms remain
-- editable through the owner/admin UI action.
revoke update on public.trust_centers from authenticated;
grant update (
  display_name,
  hero_title,
  hero_subtitle,
  overview,
  contact_email,
  logo_url,
  terms_version,
  terms_text,
  require_email_verification
) on public.trust_centers to authenticated;

-- Content rows may be managed by owners/admins, but tenant identity and
-- server-maintained columns are not client-writable.
revoke insert, update, delete on public.trust_center_faqs,
  public.certifications,
  public.subprocessors,
  public.trust_center_documents
  from authenticated;

grant insert (organization_id, question, answer, visible)
  on public.trust_center_faqs to authenticated;
grant update (question, answer, visible)
  on public.trust_center_faqs to authenticated;
grant delete on public.trust_center_faqs to authenticated;

grant insert (
  organization_id,
  name,
  status,
  issuer,
  valid_from,
  valid_until,
  demo,
  publicly_visible
) on public.certifications to authenticated;
grant update (
  name,
  status,
  issuer,
  valid_from,
  valid_until,
  demo,
  publicly_visible
) on public.certifications to authenticated;
grant delete on public.certifications to authenticated;

grant insert (
  organization_id,
  company,
  purpose,
  data_category,
  region,
  publicly_visible
) on public.subprocessors to authenticated;
grant update (
  company,
  purpose,
  data_category,
  region,
  publicly_visible
) on public.subprocessors to authenticated;
grant delete on public.subprocessors to authenticated;

grant insert (organization_id, document_id, description, publicly_requestable)
  on public.trust_center_documents to authenticated;
grant update (document_id, description, publicly_requestable)
  on public.trust_center_documents to authenticated;
grant delete on public.trust_center_documents to authenticated;

-- A card's tenant and referenced document must agree. The document check is
-- deliberately in WITH CHECK so it protects both inserts and updates.
drop policy "trust_center_documents_write_owner_admin"
  on public.trust_center_documents;
create policy "trust_center_documents_write_owner_admin"
  on public.trust_center_documents
  for all to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]))
  with check (
    private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[])
    and exists (
      select 1
      from public.documents d
      where d.id = document_id
        and d.organization_id = organization_id
    )
  );

-- ---------------------------------------------------------------------------
-- RPC: set_trust_center_slug (owner/admin; validated + audited)
-- ---------------------------------------------------------------------------

create or replace function public.set_trust_center_slug(
  p_organization_id uuid,
  p_slug text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old_slug text;
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not private.is_org_member(p_organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;
  if char_length(v_slug) not between 3 and 40
    or v_slug !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
  then
    raise exception 'TRUST_SLUG_INVALID';
  end if;
  if exists (select 1 from private.reserved_slugs where slug = v_slug) then
    raise exception 'TRUST_SLUG_RESERVED';
  end if;

  select slug into v_old_slug
  from public.trust_centers
  where organization_id = p_organization_id;
  if v_old_slug is null then
    raise exception 'TRUST_CENTER_NOT_FOUND';
  end if;

  begin
    update public.trust_centers
    set slug = v_slug
    where organization_id = p_organization_id;
  exception
    when unique_violation then
      raise exception 'TRUST_SLUG_TAKEN';
  end;

  insert into public.audit_events (
    organization_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_organization_id,
    v_actor,
    'trust_center.slug_changed',
    'trust_center',
    p_organization_id,
    jsonb_build_object('from', v_old_slug, 'to', v_slug)
  );
end;
$$;

revoke all on function public.set_trust_center_slug(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_trust_center_slug(uuid, text)
  to authenticated;
