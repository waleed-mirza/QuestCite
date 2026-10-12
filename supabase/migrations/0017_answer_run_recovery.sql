-- 0017_answer_run_recovery.sql — Week 5: recover interrupted answer-run claims.
--
-- A browser can disappear after claim_answer_run_items commits and before the
-- provider result is completed. Reclaiming immediately would permit the old
-- worker to write over the new worker, so only claims older than the bounded
-- provider timeout are recovered. Recovery is transactional with the next
-- claim and records a safe, retryable error on the item.

create or replace function private.recover_stale_answer_run_items(
  p_run_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_recovered integer;
begin
  update public.answer_run_items
  set status = 'failed',
      attempts = least(attempts + 1, 100),
      error_code = 'RUN_INTERRUPTED',
      completed_at = now()
  where run_id = p_run_id
    and status = 'processing'
    and started_at is not null
    and started_at < now() - interval '2 minutes';

  get diagnostics v_recovered = row_count;
  return v_recovered;
end;
$$;

create or replace function public.claim_answer_run_items(
  p_organization_id uuid,
  p_run_id uuid,
  p_batch_size integer
)
returns table (
  item_id uuid,
  question_id uuid,
  question_original text,
  question_normalized text,
  category text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limits private.ai_limits%rowtype;
  v_run public.answer_runs%rowtype;
  v_recovered integer;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_limits from private.ai_limits where id = true;

  if not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  if p_batch_size is null or p_batch_size < 1 or p_batch_size > v_limits.max_claim_batch then
    raise exception 'RUN_INPUT_INVALID';
  end if;

  select * into v_run from public.answer_runs
  where id = p_run_id and organization_id = p_organization_id
  for update;

  -- Same answer for unknown ids and ids outside this org (no existence leak).
  if v_run.id is null then
    raise exception 'RUN_NOT_FOUND';
  end if;

  if v_run.status not in ('pending', 'running') then
    raise exception 'RUN_NOT_ACTIVE';
  end if;

  if v_run.status = 'pending' then
    update public.answer_runs set status = 'running', started_at = now()
    where id = v_run.id;
  end if;

  -- A stale processing item can only come from an abandoned worker. Mark it
  -- failed before selecting pending work; the old worker now receives
  -- RUN_ITEM_NOT_CLAIMED if it attempts a late completion.
  v_recovered := private.recover_stale_answer_run_items(v_run.id);

  -- The last batch may have been interrupted after all other items finished.
  -- Do not leave that run in running forever; failed items remain retryable.
  if not exists (
    select 1 from public.answer_run_items
    where run_id = v_run.id and status in ('pending', 'processing')
  ) then
    update public.answer_runs
    set status = 'completed', completed_at = coalesce(completed_at, now())
    where id = v_run.id and status in ('pending', 'running');

    if v_recovered > 0 then
      insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
      values (p_organization_id, v_user_id, 'ai_run.recovered', 'answer_run', v_run.id,
              jsonb_build_object('items', v_recovered));
    end if;

    return;
  end if;

  return query
  with claimed as (
    select c.id from public.answer_run_items c
    where c.run_id = v_run.id and c.status = 'pending'
    order by c.id
    limit p_batch_size
    for update skip locked
  ),
  updated as (
    update public.answer_run_items i
    set status = 'processing', started_at = now()
    where i.id in (select id from claimed)
    returning i.id as item_id, i.question_id
  )
  select u.item_id, u.question_id, q.question_original, q.question_normalized, q.category
  from updated u
  join public.questions q on q.id = u.question_id
  order by q.position;
end;
$$;

revoke all on function private.recover_stale_answer_run_items(uuid) from public, anon, authenticated;
revoke all on function public.claim_answer_run_items(uuid, uuid, integer) from public, anon;
grant execute on function public.claim_answer_run_items(uuid, uuid, integer) to authenticated;
