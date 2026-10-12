-- 0023_trust_overview_terms.sql — Week 7 follow-up: the public request form
-- must DISPLAY the clickwrap terms (J8 step 5 "prospect accepts the
-- displayed clickwrap terms"). Adds termsVersion + termsText to the public
-- overview payload. These two fields are public by design — they are the
-- contract every prospect sees before requesting; the exact-text hash is
-- recorded against them at submission (0021).

create or replace function public.get_trust_center_overview(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', tc.slug,
    'displayName', tc.display_name,
    'heroTitle', tc.hero_title,
    'heroSubtitle', tc.hero_subtitle,
    'overview', tc.overview,
    'contactEmail', tc.contact_email,
    'logoUrl', tc.logo_url,
    'termsVersion', tc.terms_version,
    'termsText', tc.terms_text,
    'faqs', coalesce((
      select jsonb_agg(
        jsonb_build_object('question', f.question, 'answer', f.answer)
        order by f.position, f.created_at, f.id
      )
      from public.trust_center_faqs f
      where f.organization_id = tc.organization_id and f.visible
    ), '[]'::jsonb),
    'certifications', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', c.name,
          'status', c.status::text,
          'issuer', c.issuer,
          'validFrom', to_char(c.valid_from, 'YYYY-MM-DD'),
          'validUntil', to_char(c.valid_until, 'YYYY-MM-DD'),
          'demo', c.demo
        )
        order by c.position, c.created_at, c.id
      )
      from public.certifications c
      where c.organization_id = tc.organization_id and c.publicly_visible
    ), '[]'::jsonb),
    'subprocessors', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'company', s.company,
          'purpose', s.purpose,
          'dataCategory', s.data_category,
          'region', s.region
        )
        order by s.position, s.created_at, s.id
      )
      from public.subprocessors s
      where s.organization_id = tc.organization_id and s.publicly_visible
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'documentId', tcd.document_id,
          'title', d.title,
          'description', tcd.description,
          'category', d.category
        )
        order by tcd.position, tcd.created_at, tcd.id
      )
      from public.trust_center_documents tcd
      join public.documents d on d.id = tcd.document_id
      where tcd.organization_id = tc.organization_id
        and tcd.publicly_requestable
        and d.state = 'active'
        and exists (
          select 1 from public.document_versions dv
          where dv.document_id = d.id and dv.processing_state = 'ready'
        )
    ), '[]'::jsonb)
  )
  from public.trust_centers tc
  where tc.slug = p_slug and tc.status = 'published';
$$;

revoke all on function public.get_trust_center_overview(text) from public, anon, authenticated;
grant execute on function public.get_trust_center_overview(text) to anon, authenticated;
