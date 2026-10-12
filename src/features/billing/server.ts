import "server-only";

import { z } from "zod";

import { BILLING_PLAN_CODES } from "@/config/plans";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const snapshotSchema = z.object({
  plan_code: z.enum(BILLING_PLAN_CODES),
  plan_name: z.string().min(1),
  plan_description: z.string(),
  subscription_status: z.enum(["none", "trialing", "active", "past_due", "paused", "cancelled", "expired"]),
  period_start: z.string().min(1),
  ai_drafts_used: z.number().int().nonnegative(),
  ai_drafts_limit: z.number().int(),
  questionnaires_used: z.number().int().nonnegative(),
  questionnaires_limit: z.number().int(),
  documents_used: z.number().int().nonnegative(),
  documents_limit: z.number().int(),
  members_used: z.number().int().nonnegative(),
  members_limit: z.number().int(),
  trial_ends_at: z.string().nullable(),
  renews_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  customer_portal_url: z.url().nullable(),
  update_payment_url: z.url().nullable(),
  retention_days: z.number().int().min(30).max(3650),
  deletion_requested_at: z.string().nullable(),
});

export type BillingSnapshot = z.infer<typeof snapshotSchema>;

export async function getBillingSnapshot(organizationId: string): Promise<BillingSnapshot | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_billing_snapshot", { p_organization_id: organizationId });
  if (error !== null || data === null || data[0] === undefined) {
    logger.warn("billing.snapshot.unavailable", { organizationId, code: "BILLING_SNAPSHOT_FAILED" });
    return null;
  }
  const parsed = snapshotSchema.safeParse(data[0]);
  if (!parsed.success) {
    logger.warn("billing.snapshot.invalid", { organizationId, code: "BILLING_SNAPSHOT_INVALID" });
    return null;
  }
  return parsed.data;
}
