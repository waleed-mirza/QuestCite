import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  billingWebhookPayloadSchema,
  eventIdForLemonPayload,
  mapLemonEventToStatus,
  parseLemonSqueezyWebhook,
  verifyLemonSqueezySignature,
} from "@/lib/billing/webhook";

const SECRET = "unit-test-webhook-secret";

function payload(eventName: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    meta: {
      event_name: eventName,
      custom_data: { organization_id: "11111111-1111-4111-8111-111111111111" },
    },
    data: {
      type: "subscriptions",
      id: "sub-100",
      attributes: {
        store_id: 42,
        customer_id: 7,
        order_id: 8,
        product_id: 9,
        variant_id: 101,
        status: "active",
        cancelled: false,
        trial_ends_at: null,
        renews_at: "2026-10-01T00:00:00.000000Z",
        ends_at: null,
        created_at: "2026-09-04T00:00:00.000000Z",
        updated_at: "2026-09-04T00:00:01.000000Z",
        test_mode: true,
        urls: { update_payment_method: "https://billing.example/update" },
        ...overrides,
      },
    },
  };
}

describe("billing webhook boundary", () => {
  it("verifies the raw body signature and rejects malformed signatures", () => {
    const raw = JSON.stringify(payload("subscription_created"));
    const signature = createHmac("sha256", SECRET).update(raw).digest("hex");
    expect(verifyLemonSqueezySignature(raw, signature, SECRET)).toBe(true);
    expect(verifyLemonSqueezySignature(`${raw} `, signature, SECRET)).toBe(false);
    expect(verifyLemonSqueezySignature(raw, "not-hex", SECRET)).toBe(false);
    expect(verifyLemonSqueezySignature(raw, signature, "")).toBe(false);
  });

  it("normalizes subscription lifecycle events without trusting browser fields", () => {
    const raw = JSON.stringify(payload("subscription_created"));
    const parsed = parseLemonSqueezyWebhook(raw, {
      variantToPlan: new Map([["101", "starter"]]),
    });
    expect(parsed.eventType).toBe("subscription_created");
    expect(parsed.organizationId).toBe("11111111-1111-4111-8111-111111111111");
    expect(parsed.providerSubscriptionId).toBe("sub-100");
    expect(parsed.planCode).toBe("starter");
    expect(parsed.status).toBe("active");
    expect(parsed.customerId).toBe("7");
    expect(parsed.storeId).toBe("42");
    expect(parsed.updatePaymentUrl).toBe("https://billing.example/update");
    expect(eventIdForLemonPayload(parsed)).toBe(eventIdForLemonPayload(parsed));

    const changed = parseLemonSqueezyWebhook(JSON.stringify(payload("subscription_updated", { updated_at: "2026-09-04T00:00:02.000000Z" })), {
      variantToPlan: new Map([["101", "starter"]]),
    });
    expect(eventIdForLemonPayload(changed)).not.toBe(eventIdForLemonPayload(parsed));
  });

  it("accepts provider payloads with explicit null billing URLs", () => {
    const parsed = parseLemonSqueezyWebhook(
      JSON.stringify(
        payload("subscription_updated", {
          urls: { customer_portal: null, customer_portal_update_subscription: null, update_payment_method: null },
        }),
      ),
      { variantToPlan: new Map([["101", "starter"]]) },
    );
    expect(parsed.customerPortalUrl).toBeNull();
    expect(parsed.updatePaymentUrl).toBeNull();
  });

  it.each([
    ["subscription_payment_failed", "past_due"],
    ["subscription_payment_recovered", "active"],
    ["subscription_payment_success", "active"],
    ["subscription_paused", "paused"],
    ["subscription_unpaused", "active"],
    ["subscription_cancelled", "cancelled"],
    ["subscription_expired", "expired"],
  ] as const)("maps %s to %s", (eventName, status) => {
    expect(mapLemonEventToStatus(eventName, "active")).toBe(status);
  });

  it("rejects unknown variants and non-subscription resources", () => {
    expect(() =>
      parseLemonSqueezyWebhook(JSON.stringify(payload("subscription_created")), {
        variantToPlan: new Map([["999", "starter"]]),
      }),
    ).toThrow("BILLING_VARIANT_UNKNOWN");

    const order = payload("order_created");
    (order.data as Record<string, unknown>).type = "orders";
    expect(() =>
      billingWebhookPayloadSchema.parse(order),
    ).toThrow();
  });
});
