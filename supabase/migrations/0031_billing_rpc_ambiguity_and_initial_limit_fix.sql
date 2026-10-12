-- Week 8 follow-up: correct ambiguous PL/pgSQL references discovered by the
-- hosted integration test and make the first usage request fail closed when
-- it is larger than the entire entitlement.

create or replace function private.consume_usage_internal(
  p_organization_id uuid,
  p_metric text,
  p_amount integer,
  p_require_member boolean
)
returns table (
  allowed boolean,
  metric text,
  period_start date,
  used integer,
  limit_value integer,
  plan_code text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status public.organization_status;
  v_plan_code text;
  v_limit integer;
  v_used integer := 0;
  v_new_used integer;
  v_period_start date := date_trunc('month', (now() at time zone 'utc'))::date;
begin
  if p_amount is null or p_amount < 1 or p_amount > 1000 then
    raise exception 'USAGE_INPUT_INVALID';
  end if;
  if p_metric is null or p_metric not in ('ai_drafts', 'questionnaires', 'documents', 'members') then
    raise exception 'USAGE_METRIC_INVALID';
  end if;

  if p_require_member then
    if auth.uid() is null then
      raise exception 'AUTH_REQUIRED';
    end if;
    if p_metric in ('ai_drafts', 'questionnaires')
       and not private.is_org_member(p_organization_id, array['owner', 'admin', 'reviewer']::public.app_role[]) then
      raise exception 'FORBIDDEN';
    end if;
    if p_metric in ('documents', 'members')
       and not private.is_org_member(p_organization_id, array['owner', 'admin']::public.app_role[]) then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  select o.status into v_status
  from public.organizations o
  where o.id = p_organization_id
  for update;
  if v_status is null then
    raise exception 'ORG_NOT_FOUND';
  end if;
  if v_status <> 'active' then
    raise exception 'ORG_INACTIVE';
  end if;

  v_plan_code := private.billing_effective_plan(p_organization_id);
  if v_plan_code is null then
    raise exception 'USAGE_UNAVAILABLE';
  end if;

  select case p_metric
    when 'ai_drafts' then e.monthly_ai_draft_limit
    when 'questionnaires' then e.monthly_questionnaire_limit
    when 'documents' then e.document_limit
    when 'members' then e.member_limit
  end into v_limit
  from public.plan_entitlements e
  where e.plan_code = v_plan_code;
  if v_limit is null then
    raise exception 'USAGE_UNAVAILABLE';
  end if;

  if p_metric = 'members' then
    select count(*)::integer into v_used
    from public.organization_members m
    where m.organization_id = p_organization_id;
    if v_used + p_amount > v_limit then
      return query select false, p_metric, v_period_start, v_used, v_limit, v_plan_code;
      return;
    end if;
    return query select true, p_metric, v_period_start, v_used + p_amount, v_limit, v_plan_code;
    return;
  end if;

  -- The conflict predicate protects increments after a row exists. This
  -- explicit guard protects the first insert, where there is no conflict row.
  if v_limit >= 0 and p_amount > v_limit then
    return query select false, p_metric, v_period_start, 0, v_limit, v_plan_code;
    return;
  end if;

  insert into public.usage_counters (organization_id, period_start, metric, used)
  values (p_organization_id, v_period_start, p_metric, p_amount)
  on conflict on constraint usage_counters_pkey do update
    set used = public.usage_counters.used + excluded.used,
        updated_at = now()
    where v_limit < 0 or public.usage_counters.used + excluded.used <= v_limit
  returning public.usage_counters.used into v_new_used;

  if v_new_used is null then
    select coalesce(uc.used, 0) into v_used
    from public.usage_counters uc
    where uc.organization_id = p_organization_id
      and uc.period_start = v_period_start
      and uc.metric = p_metric;
    return query select false, p_metric, v_period_start, v_used, v_limit, v_plan_code;
    return;
  end if;

  return query select true, p_metric, v_period_start, v_new_used, v_limit, v_plan_code;
end;
$$;

create or replace function public.get_billing_snapshot(p_organization_id uuid)
returns table (
  plan_code text,
  plan_name text,
  plan_description text,
  subscription_status public.billing_subscription_status,
  period_start date,
  ai_drafts_used integer,
  ai_drafts_limit integer,
  questionnaires_used integer,
  questionnaires_limit integer,
  documents_used integer,
  documents_limit integer,
  members_used integer,
  members_limit integer,
  trial_ends_at timestamptz,
  renews_at timestamptz,
  ends_at timestamptz,
  customer_portal_url text,
  update_payment_url text,
  retention_days integer,
  deletion_requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan_code text;
  v_status public.billing_subscription_status := 'none';
  v_period_start date := date_trunc('month', (now() at time zone 'utc'))::date;
  v_sub public.subscriptions%rowtype;
  v_ent public.plan_entitlements%rowtype;
  v_retention integer;
  v_deletion timestamptz;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not private.is_org_member(p_organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  select s.* into v_sub from public.subscriptions s where s.organization_id = p_organization_id;
  if found then
    v_status := v_sub.status;
  end if;
  v_plan_code := private.billing_effective_plan(p_organization_id);
  select e.* into v_ent from public.plan_entitlements e where e.plan_code = v_plan_code;
  if not found then
    raise exception 'USAGE_UNAVAILABLE';
  end if;
  select o.retention_days, o.deletion_requested_at
    into v_retention, v_deletion
  from public.organizations o
  where o.id = p_organization_id;

  return query
  select
    v_ent.plan_code,
    v_ent.display_name,
    v_ent.description,
    v_status,
    v_period_start,
    coalesce((select uc.used from public.usage_counters uc where uc.organization_id = p_organization_id and uc.period_start = v_period_start and uc.metric = 'ai_drafts'), 0),
    v_ent.monthly_ai_draft_limit,
    coalesce((select uc.used from public.usage_counters uc where uc.organization_id = p_organization_id and uc.period_start = v_period_start and uc.metric = 'questionnaires'), 0),
    v_ent.monthly_questionnaire_limit,
    coalesce((select uc.used from public.usage_counters uc where uc.organization_id = p_organization_id and uc.period_start = v_period_start and uc.metric = 'documents'), 0),
    v_ent.document_limit,
    (select count(*)::integer from public.organization_members m where m.organization_id = p_organization_id),
    v_ent.member_limit,
    v_sub.trial_ends_at,
    v_sub.renews_at,
    v_sub.ends_at,
    v_sub.customer_portal_url,
    v_sub.update_payment_url,
    v_retention,
    v_deletion;
end;
$$;

create or replace function public.process_billing_webhook(
  p_provider_event_id text,
  p_event_hash text,
  p_event_type text,
  p_organization_id uuid,
  p_provider_subscription_id text,
  p_provider_invoice_id text,
  p_customer_id text,
  p_store_id text,
  p_order_id text,
  p_product_id text,
  p_variant_id text,
  p_plan_code text,
  p_status public.billing_subscription_status,
  p_trial_ends_at timestamptz,
  p_renews_at timestamptz,
  p_ends_at timestamptz,
  p_customer_portal_url text,
  p_update_payment_url text,
  p_test_mode boolean,
  p_event_occurred_at timestamptz
)
returns table (
  accepted boolean,
  duplicate boolean,
  out_of_order boolean,
  organization_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_existing_hash text;
  v_existing_org uuid;
  v_existing_last_event timestamptz;
  v_existing_plan text;
  v_org_id uuid := p_organization_id;
  v_plan_code text := p_plan_code;
  v_out_of_order boolean := false;
begin
  if p_provider_event_id is null or p_provider_event_id !~ '^[A-Za-z0-9._:-]{1,240}$'
     or p_event_hash is null or p_event_hash !~ '^[0-9a-f]{64}$'
     or p_provider_subscription_id is null
     or char_length(btrim(p_provider_subscription_id)) not between 1 and 200
  then
    raise exception 'BILLING_INPUT_INVALID';
  end if;
  if p_event_type is null or p_event_type not in (
    'subscription_created', 'subscription_updated', 'subscription_plan_changed',
    'subscription_cancelled', 'subscription_resumed', 'subscription_expired',
    'subscription_paused', 'subscription_unpaused', 'subscription_payment_success',
    'subscription_payment_failed', 'subscription_payment_recovered'
  ) then
    raise exception 'BILLING_EVENT_UNSUPPORTED';
  end if;
  if p_status is null then
    raise exception 'BILLING_INPUT_INVALID';
  end if;
  if p_plan_code is not null and p_plan_code not in ('starter', 'pro', 'agency') then
    raise exception 'BILLING_PLAN_INVALID';
  end if;

  insert into public.billing_webhook_events (
    provider_event_id, event_hash, event_type, provider_subscription_id
  ) values (
    p_provider_event_id, p_event_hash, p_event_type, p_provider_subscription_id
  ) on conflict (provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select be.event_hash, be.organization_id, be.out_of_order
      into v_existing_hash, v_existing_org, v_out_of_order
    from public.billing_webhook_events be
    where be.provider_event_id = p_provider_event_id;
    if v_existing_hash is distinct from p_event_hash then
      raise exception 'BILLING_EVENT_CONFLICT';
    end if;
    update public.billing_webhook_events
    set attempts = least(attempts + 1, 100)
    where provider_event_id = p_provider_event_id;
    return query select true, true, coalesce(v_out_of_order, false), v_existing_org;
    return;
  end if;

  select s.organization_id, s.last_event_at, s.plan_code
    into v_existing_org, v_existing_last_event, v_existing_plan
  from public.subscriptions s
  where s.provider_subscription_id = p_provider_subscription_id;
  if v_org_id is null then
    v_org_id := v_existing_org;
  elsif v_existing_org is not null and v_existing_org <> v_org_id then
    update public.billing_webhook_events
    set event_status = 'failed', last_error_code = 'BILLING_ORG_CONFLICT', processed_at = now(), organization_id = v_org_id
    where id = v_event_id;
    return query select false, false, false, v_org_id;
    return;
  end if;

  if v_org_id is null and p_customer_id is not null then
    select bc.organization_id into v_org_id
    from public.billing_customers bc
    where bc.provider_customer_id = p_customer_id;
  end if;
  if v_org_id is null then
    update public.billing_webhook_events
    set event_status = 'failed', last_error_code = 'BILLING_ORG_NOT_FOUND', processed_at = now()
    where id = v_event_id;
    return query select false, false, false, null::uuid;
    return;
  end if;

  if v_existing_org is not null and p_event_occurred_at is not null
     and v_existing_last_event is not null
     and p_event_occurred_at < v_existing_last_event
  then
    update public.billing_webhook_events
    set event_status = 'processed', organization_id = v_org_id, out_of_order = true, processed_at = now()
    where id = v_event_id;
    return query select true, false, true, v_org_id;
    return;
  end if;

  if v_plan_code is null then
    v_plan_code := v_existing_plan;
  end if;
  if v_plan_code is null then
    update public.billing_webhook_events
    set event_status = 'failed', last_error_code = 'BILLING_PLAN_MISSING', processed_at = now(), organization_id = v_org_id
    where id = v_event_id;
    return query select false, false, false, v_org_id;
    return;
  end if;

  if p_customer_id is not null then
    if exists (
      select 1 from public.billing_customers bc
      where bc.provider_customer_id = p_customer_id and bc.organization_id <> v_org_id
    ) then
      update public.billing_webhook_events
      set event_status = 'failed', last_error_code = 'BILLING_CUSTOMER_CONFLICT', processed_at = now(), organization_id = v_org_id
      where id = v_event_id;
      return query select false, false, false, v_org_id;
      return;
    end if;
    insert into public.billing_customers (organization_id, provider_customer_id, provider_store_id)
    values (v_org_id, p_customer_id, p_store_id)
    on conflict on constraint billing_customers_pkey do update set
      provider_customer_id = excluded.provider_customer_id,
      provider_store_id = coalesce(excluded.provider_store_id, public.billing_customers.provider_store_id),
      updated_at = now();
  end if;

  insert into public.subscriptions (
    organization_id, provider_subscription_id, provider_order_id, provider_invoice_id,
    provider_product_id, provider_variant_id, plan_code, status, trial_ends_at,
    renews_at, ends_at, cancelled_at, test_mode, customer_portal_url,
    update_payment_url, provider_created_at, provider_updated_at, last_event_at,
    last_event_id
  ) values (
    v_org_id, p_provider_subscription_id, p_order_id, p_provider_invoice_id,
    p_product_id, p_variant_id, v_plan_code, p_status, p_trial_ends_at,
    p_renews_at, p_ends_at,
    case when p_status = 'cancelled' then coalesce(p_event_occurred_at, now()) else null end,
    coalesce(p_test_mode, true), p_customer_portal_url, p_update_payment_url,
    p_event_occurred_at, p_event_occurred_at, p_event_occurred_at, p_provider_event_id
  ) on conflict on constraint subscriptions_organization_id_key do update set
    provider_subscription_id = excluded.provider_subscription_id,
    provider_order_id = coalesce(excluded.provider_order_id, public.subscriptions.provider_order_id),
    provider_invoice_id = coalesce(excluded.provider_invoice_id, public.subscriptions.provider_invoice_id),
    provider_product_id = coalesce(excluded.provider_product_id, public.subscriptions.provider_product_id),
    provider_variant_id = coalesce(excluded.provider_variant_id, public.subscriptions.provider_variant_id),
    plan_code = coalesce(excluded.plan_code, public.subscriptions.plan_code),
    status = excluded.status,
    trial_ends_at = coalesce(excluded.trial_ends_at, public.subscriptions.trial_ends_at),
    renews_at = coalesce(excluded.renews_at, public.subscriptions.renews_at),
    ends_at = coalesce(excluded.ends_at, public.subscriptions.ends_at),
    cancelled_at = case when excluded.status = 'cancelled' then coalesce(excluded.cancelled_at, public.subscriptions.cancelled_at) else null end,
    test_mode = excluded.test_mode,
    customer_portal_url = coalesce(excluded.customer_portal_url, public.subscriptions.customer_portal_url),
    update_payment_url = coalesce(excluded.update_payment_url, public.subscriptions.update_payment_url),
    provider_created_at = coalesce(excluded.provider_created_at, public.subscriptions.provider_created_at),
    provider_updated_at = coalesce(excluded.provider_updated_at, public.subscriptions.provider_updated_at),
    last_event_at = coalesce(excluded.last_event_at, public.subscriptions.last_event_at),
    last_event_id = excluded.last_event_id,
    updated_at = now();

  update public.billing_webhook_events
  set event_status = 'processed', organization_id = v_org_id, processed_at = now()
  where id = v_event_id;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_org_id, null, 'billing.subscription_synced', 'subscription', v_org_id,
    jsonb_build_object('event_type', p_event_type, 'status', p_status::text, 'plan_code', v_plan_code)
  );

  return query select true, false, false, v_org_id;
end;
$$;

create or replace function public.purge_organization_retention(p_organization_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_cutoff timestamptz;
  v_count integer := 0;
  v_deleted integer;
begin
  select o.retention_days into v_days from public.organizations o where o.id = p_organization_id;
  if v_days is null then raise exception 'ORG_NOT_FOUND'; end if;
  v_cutoff := now() - make_interval(days => v_days);

  delete from public.notifications where organization_id = p_organization_id and created_at < v_cutoff;
  get diagnostics v_deleted = row_count;
  v_count := v_count + v_deleted;
  delete from public.download_events where organization_id = p_organization_id and created_at < v_cutoff;
  get diagnostics v_deleted = row_count;
  v_count := v_count + v_deleted;
  delete from public.billing_webhook_events where organization_id = p_organization_id and received_at < v_cutoff;
  get diagnostics v_deleted = row_count;
  v_count := v_count + v_deleted;
  delete from public.audit_events where organization_id = p_organization_id and created_at < v_cutoff;
  get diagnostics v_deleted = row_count;
  v_count := v_count + v_deleted;
  return v_count;
end;
$$;
