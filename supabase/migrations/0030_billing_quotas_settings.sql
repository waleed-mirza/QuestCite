-- 0030_billing_quotas_settings.sql — Week 8 billing, quotas, and workspace ops.
--
-- The provider is the payment authority, but the application never grants a
-- paid plan from a browser redirect. Only the signed-webhook processor writes
-- billing state. Quota consumption is serialized by the organization row and
-- the usage-counter unique key, so concurrent requests cannot bypass a limit.

-- ---------------------------------------------------------------------------
-- Billing catalog and local provider state
-- ---------------------------------------------------------------------------

create type public.billing_subscription_status as enum (
  'none', 'trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired'
);

create table public.plan_entitlements (
  plan_code text primary key check (plan_code ~ '^[a-z][a-z0-9_]{1,30}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  description text not null check (char_length(description) between 1 and 300),
  monthly_ai_draft_limit integer not null check (monthly_ai_draft_limit >= 0),
  monthly_questionnaire_limit integer not null check (monthly_questionnaire_limit >= 0),
  document_limit integer not null check (document_limit >= 0),
  member_limit integer not null check (member_limit >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.plan_entitlements (
  plan_code, display_name, description, monthly_ai_draft_limit,
  monthly_questionnaire_limit, document_limit, member_limit
)
values
  ('free', 'Free', 'A safe fallback with metadata-only access and no paid AI entitlement.', 0, 1, 3, 3),
  ('trial', 'Trial', 'Explore the complete workflow with a monthly drafting allowance.', 25, 1, 5, 3),
  ('starter', 'Starter', 'For a small security team answering questionnaires every month.', 250, 10, 25, 10),
  ('pro', 'Pro', 'More drafting capacity and workspace room for a growing team.', 1500, 50, 100, 50),
  ('agency', 'Agency', 'High-capacity limits for teams operating across many customers.', 5000, 200, 500, 200);

create table public.billing_customers (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  provider_customer_id text not null unique check (char_length(btrim(provider_customer_id)) between 1 and 100),
  provider_store_id text check (provider_store_id is null or char_length(btrim(provider_store_id)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  provider_subscription_id text not null unique check (char_length(btrim(provider_subscription_id)) between 1 and 200),
  provider_order_id text check (provider_order_id is null or char_length(btrim(provider_order_id)) between 1 and 200),
  provider_invoice_id text check (provider_invoice_id is null or char_length(btrim(provider_invoice_id)) between 1 and 200),
  provider_product_id text check (provider_product_id is null or char_length(btrim(provider_product_id)) between 1 and 200),
  provider_variant_id text check (provider_variant_id is null or char_length(btrim(provider_variant_id)) between 1 and 200),
  plan_code text not null references public.plan_entitlements (plan_code),
  status public.billing_subscription_status not null,
  trial_ends_at timestamptz,
  renews_at timestamptz,
  ends_at timestamptz,
  cancelled_at timestamptz,
  test_mode boolean not null default true,
  customer_portal_url text check (customer_portal_url is null or char_length(customer_portal_url) <= 2000),
  update_payment_url text check (update_payment_url is null or char_length(update_payment_url) <= 2000),
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  last_event_at timestamptz,
  last_event_id text check (last_event_id is null or char_length(last_event_id) <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_status_idx on public.subscriptions (status, ends_at);

create table public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique check (char_length(btrim(provider_event_id)) between 1 and 240),
  event_hash text not null check (event_hash ~ '^[0-9a-f]{64}$'),
  event_type text not null check (event_type in (
    'subscription_created', 'subscription_updated', 'subscription_plan_changed',
    'subscription_cancelled', 'subscription_resumed', 'subscription_expired',
    'subscription_paused', 'subscription_unpaused', 'subscription_payment_success',
    'subscription_payment_failed', 'subscription_payment_recovered'
  )),
  organization_id uuid references public.organizations (id) on delete set null,
  provider_subscription_id text not null check (char_length(btrim(provider_subscription_id)) between 1 and 200),
  event_status text not null default 'received' check (event_status in ('received', 'processed', 'failed')),
  attempts integer not null default 1 check (attempts between 1 and 100),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{3,80}$'),
  out_of_order boolean not null default false,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index billing_webhook_events_received_idx
  on public.billing_webhook_events (event_status, received_at desc);
create index billing_webhook_events_organization_idx
  on public.billing_webhook_events (organization_id, received_at desc);

-- ---------------------------------------------------------------------------
-- Atomic monthly usage counters
-- ---------------------------------------------------------------------------

create table public.usage_counters (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  period_start date not null,
  metric text not null check (metric in ('ai_drafts', 'questionnaires', 'documents')),
  used integer not null default 0 check (used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, period_start, metric)
);

create index usage_counters_period_idx on public.usage_counters (period_start, metric);

-- Existing workspaces are not allowed to receive a surprise zero-usage window
-- when this migration lands. Backfill only the current monthly counters; all
-- future writes are accounted for by the insert triggers below.
insert into public.usage_counters (organization_id, period_start, metric, used)
select o.id, date_trunc('month', (now() at time zone 'utc'))::date, 'documents', count(*)::integer
from public.organizations o
left join public.documents d on d.organization_id = o.id
group by o.id
on conflict (organization_id, period_start, metric) do nothing;

insert into public.usage_counters (organization_id, period_start, metric, used)
select o.id, date_trunc('month', (now() at time zone 'utc'))::date, 'questionnaires', count(*)::integer
from public.organizations o
left join public.questionnaires q on q.organization_id = o.id
group by o.id
on conflict (organization_id, period_start, metric) do nothing;

insert into public.usage_counters (organization_id, period_start, metric, used)
select o.id, date_trunc('month', (now() at time zone 'utc'))::date, 'ai_drafts', count(*)::integer
from public.organizations o
left join public.answer_run_items ari on ari.organization_id = o.id
group by o.id
on conflict (organization_id, period_start, metric) do nothing;

-- ---------------------------------------------------------------------------
-- Workspace settings and deletion workflow
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column retention_days integer not null default 365
    check (retention_days between 30 and 3650),
  add column deletion_requested_at timestamptz,
  add column deletion_requested_by uuid references auth.users (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Timestamp triggers
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.plan_entitlements
for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.billing_customers
for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.subscriptions
for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.usage_counters
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Plan resolution and quota enforcement
-- ---------------------------------------------------------------------------

-- `none` is the stored subscription state for an organization without a
-- provider event. Such a workspace receives the local Trial onboarding plan;
-- an expired/non-active paid subscription resolves to Free. Paid access can
-- only be selected by this function after a signed webhook created/updated a
-- local subscription row.
create or replace function private.billing_effective_plan(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when s.id is null then 'trial'
    when s.status in ('active', 'trialing')
      and (s.status <> 'trialing' or s.trial_ends_at is null or s.trial_ends_at > now())
      then s.plan_code
    when s.status = 'cancelled'
      and (s.ends_at is null or s.ends_at > now())
      then s.plan_code
    else 'free'
  end
  from public.organizations o
  left join public.subscriptions s on s.organization_id = o.id
  where o.id = p_organization_id
  limit 1;
$$;

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

  -- Lock the organization before resolving the plan. This closes the race
  -- between a subscription update and a quota check and serializes member
  -- seat checks, whose source of truth is the member table itself.
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

  insert into public.usage_counters (organization_id, period_start, metric, used)
  values (p_organization_id, v_period_start, p_metric, p_amount)
  on conflict (organization_id, period_start, metric) do update
    set used = public.usage_counters.used + excluded.used,
        updated_at = now()
    where v_limit < 0 or public.usage_counters.used + excluded.used <= v_limit
  returning used into v_new_used;

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

create or replace function public.consume_usage(
  p_organization_id uuid,
  p_metric text,
  p_amount integer default 1
)
returns table (
  allowed boolean,
  metric text,
  period_start date,
  used integer,
  limit_value integer,
  plan_code text
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.consume_usage_internal($1, $2, $3, true);
$$;

create or replace function private.assert_usage_for_insert(
  p_organization_id uuid,
  p_metric text,
  p_amount integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  select c.allowed into v_allowed
  from private.consume_usage_internal(p_organization_id, p_metric, p_amount, false) c;
  if not coalesce(v_allowed, false) then
    raise exception 'QUOTA_EXCEEDED';
  end if;
end;
$$;

create or replace function private.enforce_usage_on_insert()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- Service-role fixture provisioning and controlled administrative jobs do
  -- not carry an end-user auth.uid(). Their own setup paths are not customer
  -- usage and must not consume a workspace's live quota.
  if auth.uid() is null then
    return new;
  end if;

  if tg_table_name = 'organization_members' then
    perform private.assert_usage_for_insert(new.organization_id, 'members', 1);
  elsif tg_table_name = 'documents' then
    perform private.assert_usage_for_insert(new.organization_id, 'documents', 1);
  elsif tg_table_name = 'questionnaires' then
    perform private.assert_usage_for_insert(new.organization_id, 'questionnaires', 1);
  elsif tg_table_name = 'answer_run_items' then
    perform private.assert_usage_for_insert(new.organization_id, 'ai_drafts', 1);
  end if;
  return new;
end;
$$;

create trigger enforce_member_quota before insert on public.organization_members
for each row execute function private.enforce_usage_on_insert();
create trigger enforce_document_quota before insert on public.documents
for each row execute function private.enforce_usage_on_insert();
create trigger enforce_questionnaire_quota before insert on public.questionnaires
for each row execute function private.enforce_usage_on_insert();
create trigger enforce_ai_draft_quota before insert on public.answer_run_items
for each row execute function private.enforce_usage_on_insert();

-- ---------------------------------------------------------------------------
-- Safe billing read model
-- ---------------------------------------------------------------------------

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

  select * into v_sub from public.subscriptions where organization_id = p_organization_id;
  if found then
    v_status := v_sub.status;
  end if;
  v_plan_code := private.billing_effective_plan(p_organization_id);
  select * into v_ent from public.plan_entitlements where plan_code = v_plan_code;
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
    coalesce((select used from public.usage_counters where organization_id = p_organization_id and period_start = v_period_start and metric = 'ai_drafts'), 0),
    v_ent.monthly_ai_draft_limit,
    coalesce((select used from public.usage_counters where organization_id = p_organization_id and period_start = v_period_start and metric = 'questionnaires'), 0),
    v_ent.monthly_questionnaire_limit,
    coalesce((select used from public.usage_counters where organization_id = p_organization_id and period_start = v_period_start and metric = 'documents'), 0),
    v_ent.document_limit,
    (select count(*)::integer from public.organization_members where organization_id = p_organization_id),
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

-- ---------------------------------------------------------------------------
-- Signed-webhook transaction boundary
-- ---------------------------------------------------------------------------

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
    select event_hash, organization_id, out_of_order
      into v_existing_hash, v_existing_org, v_out_of_order
    from public.billing_webhook_events
    where provider_event_id = p_provider_event_id;
    if v_existing_hash is distinct from p_event_hash then
      raise exception 'BILLING_EVENT_CONFLICT';
    end if;
    update public.billing_webhook_events
    set attempts = least(attempts + 1, 100)
    where provider_event_id = p_provider_event_id;
    return query select true, true, coalesce(v_out_of_order, false), v_existing_org;
    return;
  end if;

  -- Created events carry the organization in signed checkout custom data.
  -- Later events are resolved from provider subscription/customer ids already
  -- stored locally; no browser-supplied organization or plan is consulted.
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
    on conflict (organization_id) do update set
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
  ) on conflict (organization_id) do update set
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

-- ---------------------------------------------------------------------------
-- Workspace settings, deletion, and retention maintenance
-- ---------------------------------------------------------------------------

create or replace function public.update_workspace_settings(
  p_organization_id uuid,
  p_retention_days integer,
  p_ai_drafts_disabled boolean
)
returns table (retention_days integer, ai_drafts_disabled boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_retention_days is null or p_retention_days not between 30 and 3650
     or p_ai_drafts_disabled is null then
    raise exception 'SETTINGS_INPUT_INVALID';
  end if;
  if not private.is_org_member(p_organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  update public.organizations
  set retention_days = p_retention_days,
      ai_drafts_disabled = p_ai_drafts_disabled,
      updated_at = now()
  where id = p_organization_id and status = 'active';
  if not found then
    raise exception 'ORG_NOT_FOUND';
  end if;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_organization_id, auth.uid(), 'organization.settings_updated', 'organization', p_organization_id,
    jsonb_build_object('retention_days', p_retention_days, 'ai_drafts_disabled', p_ai_drafts_disabled)
  );
  return query select p_retention_days, p_ai_drafts_disabled;
end;
$$;

create or replace function public.request_organization_deletion(
  p_organization_id uuid,
  p_confirmation_slug text
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_requested_at timestamptz;
begin
  if not private.is_org_member(p_organization_id, array['owner']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;
  select slug into v_slug from public.organizations where id = p_organization_id and status = 'active';
  if v_slug is null then raise exception 'ORG_NOT_FOUND'; end if;
  if lower(btrim(coalesce(p_confirmation_slug, ''))) <> lower(v_slug) then
    raise exception 'DELETE_CONFIRMATION_INVALID';
  end if;

  update public.organizations
  set deletion_requested_at = coalesce(deletion_requested_at, now()),
      deletion_requested_by = auth.uid(),
      updated_at = now()
  where id = p_organization_id
  returning deletion_requested_at into v_requested_at;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'organization.deletion_requested', 'organization', p_organization_id, '{}'::jsonb);
  return v_requested_at;
end;
$$;

create or replace function public.cancel_organization_deletion(p_organization_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_org_member(p_organization_id, array['owner']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;
  update public.organizations
  set deletion_requested_at = null, deletion_requested_by = null, updated_at = now()
  where id = p_organization_id;
end;
$$;

create or replace function public.delete_organization(
  p_organization_id uuid,
  p_confirmation_slug text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_requested_at timestamptz;
begin
  if not private.is_org_member(p_organization_id, array['owner']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;
  select slug, deletion_requested_at into v_slug, v_requested_at
  from public.organizations where id = p_organization_id and status = 'active';
  if v_slug is null then raise exception 'ORG_NOT_FOUND'; end if;
  if lower(btrim(coalesce(p_confirmation_slug, ''))) <> lower(v_slug) then
    raise exception 'DELETE_CONFIRMATION_INVALID';
  end if;
  if v_requested_at is null then
    raise exception 'DELETION_NOT_REQUESTED';
  end if;
  delete from public.organizations where id = p_organization_id;
  return true;
end;
$$;

-- Called by a controlled server-side maintenance job. It prunes operational
-- history only; document and answer content is never silently removed by the
-- retention setting. No browser role can execute this function.
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
begin
  select retention_days into v_days from public.organizations where id = p_organization_id;
  if v_days is null then raise exception 'ORG_NOT_FOUND'; end if;
  v_cutoff := now() - make_interval(days => v_days);

  delete from public.notifications where organization_id = p_organization_id and created_at < v_cutoff;
  get diagnostics v_count = row_count;
  delete from public.download_events where organization_id = p_organization_id and created_at < v_cutoff;
  v_count := v_count + 0;
  delete from public.billing_webhook_events where organization_id = p_organization_id and received_at < v_cutoff;
  delete from public.audit_events where organization_id = p_organization_id and created_at < v_cutoff;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and explicit grants
-- ---------------------------------------------------------------------------

revoke all on public.plan_entitlements, public.billing_customers, public.subscriptions,
  public.billing_webhook_events, public.usage_counters
from anon, authenticated;

alter table public.plan_entitlements enable row level security;
alter table public.billing_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.usage_counters enable row level security;

grant select on public.plan_entitlements to authenticated;
create policy "plan_entitlements_select_authenticated" on public.plan_entitlements
  for select to authenticated using (true);

grant select on public.subscriptions to authenticated;
create policy "subscriptions_select_billing_manager" on public.subscriptions
  for select to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

grant select on public.usage_counters to authenticated;
create policy "usage_counters_select_billing_manager" on public.usage_counters
  for select to authenticated
  using (private.is_org_member(organization_id, array['owner', 'admin']::public.app_role[]));

revoke all on function private.billing_effective_plan(uuid) from public, anon, authenticated;
revoke all on function private.consume_usage_internal(uuid, text, integer, boolean) from public, anon, authenticated;
revoke all on function private.assert_usage_for_insert(uuid, text, integer) from public, anon, authenticated;
revoke all on function private.enforce_usage_on_insert() from public, anon, authenticated;

revoke all on function public.consume_usage(uuid, text, integer) from public, anon;
grant execute on function public.consume_usage(uuid, text, integer) to authenticated;
revoke all on function public.get_billing_snapshot(uuid) from public, anon;
grant execute on function public.get_billing_snapshot(uuid) to authenticated;

revoke all on function public.process_billing_webhook(
  text, text, text, uuid, text, text, text, text, text, text, text, text,
  public.billing_subscription_status, timestamptz, timestamptz, timestamptz,
  text, text, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.process_billing_webhook(
  text, text, text, uuid, text, text, text, text, text, text, text, text,
  public.billing_subscription_status, timestamptz, timestamptz, timestamptz,
  text, text, boolean, timestamptz
) to service_role;

revoke all on function public.update_workspace_settings(uuid, integer, boolean) from public, anon;
grant execute on function public.update_workspace_settings(uuid, integer, boolean) to authenticated;
revoke all on function public.request_organization_deletion(uuid, text) from public, anon;
grant execute on function public.request_organization_deletion(uuid, text) to authenticated;
revoke all on function public.cancel_organization_deletion(uuid) from public, anon;
grant execute on function public.cancel_organization_deletion(uuid) to authenticated;
revoke all on function public.delete_organization(uuid, text) from public, anon;
grant execute on function public.delete_organization(uuid, text) to authenticated;
revoke all on function public.purge_organization_retention(uuid) from public, anon, authenticated;
grant execute on function public.purge_organization_retention(uuid) to service_role;
