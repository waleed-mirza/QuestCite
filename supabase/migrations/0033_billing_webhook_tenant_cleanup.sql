-- Billing webhook inbox rows are tenant-owned operational data. Workspace
-- deletion must remove them instead of leaving orphaned provider identifiers.
alter table public.billing_webhook_events
  drop constraint billing_webhook_events_organization_id_fkey,
  add constraint billing_webhook_events_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade;
