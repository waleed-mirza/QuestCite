import { CreditCard } from "lucide-react";

import { AccessDenied } from "@/components/feedback/access-denied";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { plans } from "@/config/plans";
import { CheckoutPicker } from "@/features/billing/components/checkout-picker";
import { getBillingSnapshot } from "@/features/billing/server";
import { guardOrgRoles } from "@/server/authorization/guard";

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams?: Promise<{ checkout?: string }>;
}) {
  const { orgSlug } = await params;
  const guard = await guardOrgRoles(orgSlug, ["owner", "admin"]);
  if (!guard.ok) {
    if (guard.reason === "forbidden") return <AccessDenied what="billing management" />;
    return <Card><CardHeader><CardTitle>Workspace not found</CardTitle><CardDescription>We couldn&apos;t load this workspace.</CardDescription></CardHeader></Card>;
  }

  const snapshot = await getBillingSnapshot(guard.ctx.organization.id);
  if (snapshot === null) {
    return (
      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <CardTitle>Billing is temporarily unavailable</CardTitle>
          <CardDescription>We couldn&apos;t read the current entitlement safely. Try again shortly.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const query = searchParams === undefined ? {} : await searchParams;
  const plan = plans[snapshot.plan_code];
  const statusLabel = snapshot.subscription_status === "none" ? "Trial workspace" : snapshot.subscription_status.replace("_", " ");
  const renewal = snapshot.renews_at ?? snapshot.trial_ends_at;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6">
      <div>
        <div className="flex items-center gap-2">
          <CreditCard aria-hidden="true" className="text-primary size-5" />
          <h1 className="text-2xl font-semibold tracking-tight">Billing &amp; plan</h1>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">Entitlements are updated from signed provider events, never from a browser redirect.</p>
      </div>

      {query.checkout === "complete" ? (
        <div className="border-primary/30 bg-primary/5 rounded-lg border p-3 text-sm" role="status">
          Payment returned successfully. The plan will appear here after the signed billing webhook is processed.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{plan.name}</CardTitle>
          <CardDescription>{statusLabel} · Current UTC period began {snapshot.period_start}.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Usage label="AI drafts" used={snapshot.ai_drafts_used} limit={snapshot.ai_drafts_limit} />
          <Usage label="Questionnaires" used={snapshot.questionnaires_used} limit={snapshot.questionnaires_limit} />
          <Usage label="Documents" used={snapshot.documents_used} limit={snapshot.documents_limit} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subscription status</CardTitle>
          <CardDescription>
            {renewal === null ? "No renewal date is available." : `${snapshot.subscription_status === "cancelled" ? "Access ends" : "Renews"} ${new Date(renewal).toLocaleDateString()}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {snapshot.customer_portal_url !== null ? <a className="border-border rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted" href={snapshot.customer_portal_url} rel="noreferrer" target="_blank">Open customer portal</a> : null}
          {snapshot.update_payment_url !== null ? <a className="border-border rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted" href={snapshot.update_payment_url} rel="noreferrer" target="_blank">Update payment method</a> : null}
          {snapshot.customer_portal_url === null && snapshot.update_payment_url === null ? <p className="text-muted-foreground text-sm">A customer portal link will appear after the first provider sync.</p> : null}
        </CardContent>
      </Card>

      <CheckoutPicker orgSlug={orgSlug} currentPlan={snapshot.plan_code} />
    </div>
  );
}
function Usage({ label, used, limit }: { label: string; used: number; limit: number }) {
  const percent = limit <= 0 ? (used > 0 ? 100 : 0) : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="grid gap-1.5">
      <div className="flex justify-between gap-2 text-sm"><span>{label}</span><span className="text-muted-foreground">{used.toLocaleString()} / {limit.toLocaleString()}</span></div>
      <progress className="h-2 w-full accent-primary" max={100} value={percent} aria-label={`${label} usage`} />
    </div>
  );
}
