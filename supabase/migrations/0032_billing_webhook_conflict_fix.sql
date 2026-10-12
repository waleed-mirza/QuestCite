-- Week 8 follow-up: the subscription/customer upserts must name their
-- constraints because the RPC also returns an organization_id column.

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
