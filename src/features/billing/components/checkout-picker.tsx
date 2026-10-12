"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { plans, type PaidPlanCode } from "@/config/plans";
import { startCheckoutAction, type BillingActionState } from "@/features/billing/actions";

const initialState: BillingActionState = { status: "idle" };
const paidPlans: readonly PaidPlanCode[] = ["starter", "pro", "agency"];

export function CheckoutPicker({ orgSlug, currentPlan }: { orgSlug: string; currentPlan: string }) {
  const [state, action] = useActionState<BillingActionState, FormData>(
    (previous, formData) => startCheckoutAction(orgSlug, previous, formData),
    initialState,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a plan</CardTitle>
        <CardDescription>
          Checkout opens with the billing provider. Your workspace changes plan only after a verified webhook is processed.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {state.status === "error" ? <p className="text-destructive text-sm" role="alert">{state.message}</p> : null}
        {state.status === "ready" ? (
          <div className="border-primary/30 bg-primary/5 grid gap-2 rounded-lg border p-3 text-sm" role="status">
            <p>Checkout is ready. Complete payment in the provider window; entitlement updates after the webhook.</p>
            <a className="font-medium underline underline-offset-4" href={state.checkoutUrl} rel="noreferrer" target="_blank">
              Continue to secure checkout
            </a>
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-3">
          {paidPlans.map((code) => {
            const plan = plans[code];
            const isCurrent = currentPlan === code;
            return (
              <form key={code} action={action} className="border-border grid gap-3 rounded-lg border p-4">
                <input type="hidden" name="planCode" value={code} />
                <div>
                  <h2 className="font-medium">{plan.name}</h2>
                  <p className="text-muted-foreground mt-1 text-xs">{plan.description}</p>
                </div>
                <p className="text-sm">
                  <span className="font-semibold">{plan.monthlyAiDrafts.toLocaleString()}</span> AI drafts/month
                </p>
                <Button type="submit" variant={isCurrent ? "secondary" : "default"} disabled={isCurrent}>
                  {isCurrent ? "Current plan" : `Choose ${plan.name}`}
                </Button>
              </form>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
