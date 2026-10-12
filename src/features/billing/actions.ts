"use server";

import { revalidatePath } from "next/cache";

import { createLemonSqueezyCheckout } from "@/lib/billing/lemon-squeezy";
import { paidPlanSchema } from "@/lib/validation/billing";
import { logger } from "@/lib/observability/logger";
import { requireOrgRole } from "@/server/authorization/org";
import { requireUser } from "@/server/auth/session";
import { isForbiddenError, isNotFoundError, isUnauthorizedError } from "@/server/errors";

export type BillingActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ready"; checkoutUrl: string };

function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
export async function startCheckoutAction(
  orgSlug: string,
  _prev: BillingActionState | null,
  formData: FormData,
): Promise<BillingActionState> {
  try {
    const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
    const plan = paidPlanSchema.safeParse(formText(formData, "planCode"));
    if (!plan.success) {
      return { status: "error", message: "Choose a valid paid plan." };
    }

    const user = await requireUser();
    if (user.email === "") {
      return { status: "error", message: "Your account needs a verified email before checkout." };
    }
    const result = await createLemonSqueezyCheckout({
      organizationId: ctx.organization.id,
      orgSlug: ctx.organization.slug,
      email: user.email,
      planCode: plan.data,
    });
    if (result.status === "ready") {
      revalidatePath(`/app/${orgSlug}/billing`);
      return { status: "ready", checkoutUrl: result.url };
    }
    if (result.status === "unconfigured") {
      return { status: "error", message: "Billing checkout is not configured yet. Contact your workspace owner." };
    }
    logger.warn("billing.checkout.action_failed", { organizationId: ctx.organization.id, code: result.code });
    return { status: "error", message: "Checkout is temporarily unavailable. Please try again." };
  } catch (error) {
    if (isUnauthorizedError(error)) return { status: "error", message: "Sign in to manage billing." };
    if (isForbiddenError(error)) return { status: "error", message: "Only workspace owners and admins can manage billing." };
    if (isNotFoundError(error)) return { status: "error", message: "Workspace not found." };
    logger.warn("billing.checkout.action_failed", { code: "BILLING_ACTION_FAILED" });
    return { status: "error", message: "We couldn't start checkout. Please try again." };
  }
}
