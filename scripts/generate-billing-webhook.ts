import { createHmac } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { z } from "zod";

loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });

const eventNames = [
  "subscription_created",
  "subscription_updated",
  "subscription_plan_changed",
  "subscription_cancelled",
  "subscription_resumed",
  "subscription_expired",
  "subscription_paused",
  "subscription_unpaused",
  "subscription_payment_success",
  "subscription_payment_failed",
  "subscription_payment_recovered",
] as const;

const optionsSchema = z.object({
  event: z.enum(eventNames),
  orgId: z.uuid(),
  subscriptionId: z.string().trim().min(1).max(200),
  variantId: z.string().regex(/^\d+$/),
  status: z.string().trim().min(1).max(40),
  storeId: z.string().regex(/^\d+$/),
  customerId: z.string().trim().min(1).max(100),
});

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index < 0 ? undefined : process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}
const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET?.trim();
if (secret === undefined || secret === "") {
  process.stderr.write("Missing LEMON_SQUEEZY_WEBHOOK_SECRET; set it in test mode before generating a fixture.\n");
  process.exitCode = 1;
} else {
  const parsed = optionsSchema.safeParse({
    event: option("event") ?? "subscription_created",
    orgId: option("org-id"),
    subscriptionId: option("subscription-id") ?? `fixture-subscription-${Date.now()}`,
    variantId: option("variant-id") ?? process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID ?? "101",
    status: option("status") ?? "active",
    storeId: option("store-id") ?? process.env.LEMON_SQUEEZY_STORE_ID ?? "42",
    customerId: option("customer-id") ?? "fixture-customer",
  });
  if (!parsed.success) {
    process.stderr.write("Usage: pnpm billing:webhook-fixture -- --org-id <uuid> [--event <event>] [--variant-id <id>]\n");
    process.exitCode = 1;
  } else {
    const now = new Date().toISOString();
    const payload = {
      meta: {
        event_name: parsed.data.event,
        custom_data: { organization_id: parsed.data.orgId },
      },
      data: {
        type: "subscriptions",
        id: parsed.data.subscriptionId,
        attributes: {
          store_id: Number(parsed.data.storeId),
          customer_id: parsed.data.customerId,
          order_id: "fixture-order",
          product_id: "fixture-product",
          variant_id: Number(parsed.data.variantId),
          status: parsed.data.status,
          created_at: now,
          updated_at: now,
          test_mode: true,
          urls: {
            customer_portal: "https://app.invalid/fixture-portal",
            update_payment_method: "https://app.invalid/fixture-payment",
          },
        },
      },
    };
    const raw = JSON.stringify(payload);
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    process.stdout.write(`${raw}\nX-Signature: ${signature}\n`);
  }
}
