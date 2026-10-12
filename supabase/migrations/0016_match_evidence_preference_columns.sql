-- 0016_match_evidence_preference_columns.sql — Week 5: retrieval preference
-- signals. Forward-only.
--
-- plan §10 step 5: "Prefer approved Q&A entries, current document versions,
-- matching product/geography tags, and non-expired evidence." Current
-- versions and approval are ALREADY enforced by the WHERE clauses (0003);
-- tags and expiry were not part of the output, so the retrieval service
-- could not rank on them without extra per-match queries.
--
-- Widens match_org_evidence's output with four additive columns:
--   tags text[]            — document tags (chunks) / entry tags
--   category text          — document category (chunks) / entry category
--   review_by date         — review date of the evidence (stale/expiry signal)
--   is_approved_answer bool— true for approved knowledge entries (the "cited
--                            approved answer" input to evidence strength)
-- Appended at the END of the output so positional consumers keep their
-- columns; supabase-js reads by name.
--
-- The return TYPE changes, which `create or replace` refuses — the function
-- is dropped and recreated with identical logic (0009 operator
-- qualification preserved) plus the four pass-through columns. Privileges
-- die with the drop and are re-asserted here.

drop function public.match_org_evidence(uuid, extensions.vector(1536), text, integer);

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
  combined_score double precision,
  tags text[],
  category text,
  review_by date,
  is_approved_answer boolean
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
      (0.75 * cs.vector_similarity + 0.25 * cs.raw_rank / m.max_rank) as combined_score,
      d.tags as tags,
      d.category as category,
      d.review_by as review_by,
      false as is_approved_answer
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
      (0.25 * es.raw_rank / m.max_rank) as combined_score,
      ke.tags as tags,
      ke.category as category,
      ke.review_by as review_by,
      true as is_approved_answer
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

-- ---------------------------------------------------------------------------
-- Function privileges (drop removed them; re-assert the 0003 lockdown)
-- ---------------------------------------------------------------------------

revoke all on function public.match_org_evidence(uuid, extensions.vector(1536), text, integer) from public, anon;
grant execute on function public.match_org_evidence(uuid, extensions.vector(1536), text, integer) to authenticated;
