import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "fixture-webhook-secret";
const rpc = vi.fn();

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    LEMON_SQUEEZY_WEBHOOK_SECRET: SECRET,
    LEMON_SQUEEZY_STORE_ID: "42",
    LEMON_SQUEEZY_STARTER_VARIANT_ID: "101",
    LEMON_SQUEEZY_PRO_VARIANT_ID: "102",
    LEMON_SQUEEZY_AGENCY_VARIANT_ID: "103",
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/observability/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/webhooks/lemonsqueezy/route";

const payload = JSON.stringify({
  meta: {
    event_name: "subscription_created",
    custom_data: { organization_id: "00000000-0000-4000-8000-000000000001" },
  },
  data: {
    type: "subscriptions",
    id: "sub-1",
    attributes: {
      store_id: 42,
      customer_id: 7,
      order_id: 8,
      product_id: 9,
      variant_id: 101,
      status: "active",
      created_at: "2026-09-04T00:00:00Z",
      updated_at: "2026-09-04T00:00:00Z",
      test_mode: true,
      urls: {
        customer_portal: "https://billing.example.test/portal",
        update_payment_method: "https://billing.example.test/payment",
      },
    },
  },
});
function signedHeaders(body: string): HeadersInit {
  return { "x-signature": createHmac("sha256", SECRET).update(body).digest("hex") };
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: [{ accepted: true, duplicate: false, out_of_order: false, organization_id: "org-1" }],
    error: null,
  });
});

describe("billing webhook route", () => {
  it("accepts a valid signature and sends only normalized fields to the RPC", async () => {
    const response = await POST(new Request("https://app.example.test/api/webhooks/lemonsqueezy", {
      method: "POST",
      headers: signedHeaders(payload),
      body: payload,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "accepted", duplicate: false });
    expect(rpc).toHaveBeenCalledWith("process_billing_webhook", expect.objectContaining({
      p_plan_code: "starter",
      p_store_id: "42",
      p_organization_id: "00000000-0000-4000-8000-000000000001",
    }));
  });

  it.each([
    ["missing", undefined],
    ["invalid", "0".repeat(64)],
  ])("rejects a %s signature before touching the database", async (_label, signature) => {
    const headers = signature === undefined ? {} : { "x-signature": signature };
    const response = await POST(new Request("https://app.example.test/api/webhooks/lemonsqueezy", {
      method: "POST",
      headers,
      body: payload,
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: "error", code: "BILLING_SIGNATURE_INVALID" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a signed malformed payload with a safe code", async () => {
    const body = "not-json";
    const response = await POST(new Request("https://app.example.test/api/webhooks/lemonsqueezy", {
      method: "POST",
      headers: signedHeaders(body),
      body,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: "error", code: "BILLING_PAYLOAD_INVALID" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns a retryable safe response when the transaction boundary is unavailable", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "provider/internal details" } });
    const response = await POST(new Request("https://app.example.test/api/webhooks/lemonsqueezy", {
      method: "POST",
      headers: signedHeaders(payload),
      body: payload,
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "error", code: "BILLING_RPC_FAILED" });
  });
});
