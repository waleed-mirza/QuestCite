-- 0009_match_evidence_operator.sql — Week 3: resolve the pgvector cosine
-- operator inside a locked-down search_path. Forward-only.
--
-- match_org_evidence runs with `search_path = ''` (plan §7 definer rule), and
-- OPERATORS are resolved through the search_path exactly like functions — the
-- unqualified `<=>` therefore failed with "operator does not exist:
-- extensions.vector <=> extensions.vector" the moment a member actually
-- searched. Qualify the operator explicitly: OPERATOR(extensions.<=>).
--
-- Only the operator references change; logic is identical to 0003.

create or replace function public.match_org_evidence(
  p_organization_id uuid,
  p_query_embedding extensions.vector(1536),
  p_query_text text,
  p_match_count integer default 8
)
returns table (
  source_type text,
  source_id uuid,
  document_id uuid,
  document_title text,
  section text,
  content text,
  vector_similarity double precision,
  text_rank double precision,
  combined_score double precision
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Tenancy BEFORE data: a non-member (or cross-org probe) gets FORBIDDEN —
  -- never an empty result that could be probed for behavioral differences.
  if not private.is_org_member(p_organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  if p_match_count < 1 or p_match_count > 50 then
    raise exception 'EVIDENCE_QUERY_INVALID';
  end if;

  return query
  with query as (
    select websearch_to_tsquery('english', coalesce(p_query_text, '')) as tsq
  ),
  current_versions as (
    select distinct on (v.document_id)
      v.id as version_id, v.document_id
    from public.document_versions v
    join public.documents d on d.id = v.document_id
    where d.organization_id = p_organization_id
      and d.state = 'active'
      and v.processing_state = 'ready'
    order by v.document_id, v.version_number desc
  ),
  chunk_scores as (
    select
      c.id as chunk_id,
      c.document_id,
      c.section,
      c.content,
      case when p_query_embedding is null then 0.0
           else greatest(0.0::double precision, (1.0::double precision - (c.embedding OPERATOR(extensions.<=>) p_query_embedding)::double precision))
      end as vector_similarity,
      coalesce(ts_rank_cd(c.search_vector, query.tsq), 0.0)::double precision as raw_rank
    from public.document_chunks c
    join current_versions cv on cv.version_id = c.version_id
    cross join query
    where c.embedding is not null
      and (p_query_embedding is null or (c.embedding OPERATOR(extensions.<=>) p_query_embedding) < 0.85)
  ),
  max_chunk_rank as (
    select greatest(max(raw_rank), 0.0001) as max_rank from chunk_scores
  ),
  ranked_chunks as (
    select
      'document_chunk'::text as source_type,
      cs.chunk_id as source_id,
      cs.document_id,
      d.title as document_title,
      cs.section,
      cs.content,
      cs.vector_similarity,
      (cs.raw_rank / m.max_rank) as text_rank,
      (0.75 * cs.vector_similarity + 0.25 * cs.raw_rank / m.max_rank) as combined_score
    from chunk_scores cs
    join public.documents d on d.id = cs.document_id
    cross join max_chunk_rank m
    where cs.vector_similarity > 0.05 or cs.raw_rank > 0
    order by combined_score desc
    limit least(p_match_count, 50)
  ),
  entry_scores as (
    select
      ke.id as entry_id,
      ts_rank_cd(ke.search_vector, query.tsq)::double precision as raw_rank
    from public.knowledge_entries ke
    cross join query
    where ke.organization_id = p_organization_id
      and ke.review_state = 'approved'
      and query.tsq::text <> ''
      and ke.search_vector @@ query.tsq
  ),
  max_entry_rank as (
    select greatest(max(raw_rank), 0.0001) as max_rank from entry_scores
  ),
  ranked_entries as (
    select
      'knowledge_entry'::text as source_type,
      es.entry_id as source_id,
      null::uuid as document_id,
      null::text as document_title,
      ''::text as section,
      left(ke.question || E'\n\n' || ke.answer, 8000) as content,
      0.0::double precision as vector_similarity,
      (es.raw_rank / m.max_rank) as text_rank,
      (0.25 * es.raw_rank / m.max_rank) as combined_score
    from entry_scores es
    join public.knowledge_entries ke on ke.id = es.entry_id
    cross join max_entry_rank m
    order by combined_score desc
    limit least(p_match_count, 50)
  )
  select * from ranked_chunks
  union all
  select * from ranked_entries
  order by combined_score desc
  limit least(p_match_count, 50);
end;
$$;
