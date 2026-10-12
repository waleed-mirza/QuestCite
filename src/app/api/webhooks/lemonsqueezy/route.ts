import { NextResponse } from "next/server";

import { PAID_PLAN_CODES, type BillingPlanCode } from "@/config/plans";
import { getServerEnv } from "@/lib/env";
import {
  eventIdForLemonPayload,
  parseLemonSqueezyWebhook,
  verifyLemonSqueezySignature,
  type ParsedLemonSqueezyWebhook,
} from "@/lib/billing/webhook";
import { logger } from "@/lib/observability/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database.types";

export const maxDuration = 10;

type ProcessArgs = Database["public"]["Functions"]["process_billing_webhook"]["Args"];
type ProcessArgsNullable = Omit<
  ProcessArgs,
  | "p_organization_id"
  | "p_provider_invoice_id"
  | "p_customer_id"
  | "p_store_id"
  | "p_order_id"
  | "p_product_id"
  | "p_variant_id"
  | "p_plan_code"
  | "p_trial_ends_at"
  | "p_renews_at"
  | "p_ends_at"
  | "p_customer_portal_url"
  | "p_update_payment_url"
  | "p_event_occurred_at"
> & {
  p_organization_id: string | null;
  p_provider_invoice_id: string | null;
  p_customer_id: string | null;
  p_store_id: string | null;
  p_order_id: string | null;
  p_product_id: string | null;
  p_variant_id: string | null;
  p_plan_code: string | null;
  p_trial_ends_at: string | null;
  p_renews_at: string | null;
  p_ends_at: string | null;
  p_customer_portal_url: string | null;
  p_update_payment_url: string | null;
  p_event_occurred_at: string | null;
};

const PARSE_ERROR_CODES = new Set([
  "BILLING_PAYLOAD_INVALID",
  "BILLING_SUBSCRIPTION_ID_MISSING",
  "BILLING_VARIANT_UNKNOWN",
  "BILLING_EVENT_UNSUPPORTED",
]);

function response(status: number, body: Record<string, boolean | string | null>): NextResponse {
  return NextResponse.json(body, { status });
}

function parseErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  return PARSE_ERROR_CODES.has(code) ? code : "BILLING_PAYLOAD_INVALID";
}

function variantMap(env: ReturnType<typeof getServerEnv>): ReadonlyMap<string, BillingPlanCode> {
  const configured = [
    [env.LEMON_SQUEEZY_STARTER_VARIANT_ID, PAID_PLAN_CODES[0]],
    [env.LEMON_SQUEEZY_PRO_VARIANT_ID, PAID_PLAN_CODES[1]],
    [env.LEMON_SQUEEZY_AGENCY_VARIANT_ID, PAID_PLAN_CODES[2]],
  ] as const;
  return new Map(configured.filter((entry): entry is [string, (typeof PAID_PLAN_CODES)[number]] => entry[0] !== undefined));
}

function processArgs(event: ParsedLemonSqueezyWebhook): ProcessArgs {
  const args: ProcessArgsNullable = {
    p_provider_event_id: eventIdForLemonPayload(event),
    p_event_hash: event.eventHash,
    p_event_type: event.eventType,
    p_organization_id: event.organizationId,
    p_provider_subscription_id: event.providerSubscriptionId,
    p_provider_invoice_id: event.providerInvoiceId,
    p_customer_id: event.customerId,
    p_store_id: event.storeId,
    p_order_id: event.orderId,
    p_product_id: event.productId,
    p_variant_id: event.variantId,
    p_plan_code: event.planCode,
    p_status: event.status,
    p_trial_ends_at: event.trialEndsAt,
    p_renews_at: event.renewsAt,
    p_ends_at: event.endsAt,
    p_customer_portal_url: event.customerPortalUrl,
    p_update_payment_url: event.updatePaymentUrl,
    p_test_mode: event.testMode,
    p_event_occurred_at: event.eventOccurredAt,
  };
  // Supabase's generated Args type represents nullable Postgres parameters as
  // required values. The SQL function accepts the validated NULLs above; keep
  // this single reviewed assertion at the server/provider boundary.
  return args as ProcessArgs;
}

export async function POST(request: Request): Promise<NextResponse> {
  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv();
  } catch {
    return response(503, { status: "error", code: "BILLING_NOT_CONFIGURED" });
  }

  if (env.LEMON_SQUEEZY_WEBHOOK_SECRET === undefined) {
    return response(503, { status: "error", code: "BILLING_NOT_CONFIGURED" });
  }

  const rawBody = await request.text();
  if (rawBody.length === 0 || rawBody.length > 1_000_000) {
    return response(400, { status: "error", code: "BILLING_PAYLOAD_INVALID" });
  }
  if (!verifyLemonSqueezySignature(rawBody, request.headers.get("x-signature"), env.LEMON_SQUEEZY_WEBHOOK_SECRET)) {
    return response(401, { status: "error", code: "BILLING_SIGNATURE_INVALID" });
  }

  let event: ParsedLemonSqueezyWebhook;
  try {
    event = parseLemonSqueezyWebhook(rawBody, { variantToPlan: variantMap(env) });
  } catch (error) {
    return response(400, { status: "error", code: parseErrorCode(error) });
  }

  if (env.LEMON_SQUEEZY_STORE_ID !== undefined && event.storeId !== env.LEMON_SQUEEZY_STORE_ID) {
    return response(400, { status: "error", code: "BILLING_STORE_MISMATCH" });
  }

  try {
    const { data, error } = await createSupabaseAdminClient().rpc("process_billing_webhook", processArgs(event));
    if (error !== null) {
      logger.error("billing.webhook.rpc_failed", { code: "BILLING_RPC_FAILED" });
      return response(503, { status: "error", code: "BILLING_RPC_FAILED" });
    }
    const result = data?.[0];
    if (result === undefined) {
      logger.error("billing.webhook.empty_result", { code: "BILLING_RPC_FAILED" });
      return response(503, { status: "error", code: "BILLING_RPC_FAILED" });
    }
    return response(200, {
      status: "accepted",
      duplicate: result.duplicate,
      outOfOrder: result.out_of_order,
    });
  } catch {
    logger.error("billing.webhook.unavailable", { code: "BILLING_RPC_FAILED" });
    return response(503, { status: "error", code: "BILLING_RPC_FAILED" });
  }
}
