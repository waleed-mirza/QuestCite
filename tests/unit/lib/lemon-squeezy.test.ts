import { afterEach, describe, expect, it, vi } from "vitest";

import { resetServerEnvCache } from "@/lib/env";
import {
  buildCheckoutRequest,
  createLemonSqueezyCheckout,
  type CheckoutConfig,
} from "@/lib/billing/lemon-squeezy";

const config: CheckoutConfig = {
  apiKey: "fixture-api-key",
  storeId: "42",
  variantIds: { starter: "101", pro: "102", agency: "103" },
  appUrl: "https://app.example.test",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

describe("checkout request boundary", () => {
  it("selects the server-owned variant for the requested paid plan", () => {
    const request = buildCheckoutRequest({
      organizationId: "00000000-0000-4000-8000-000000000001",
      orgSlug: "acme",
      email: "owner@example.com",
      planCode: "pro",
    }, config);

    expect(request.ok).toBe(true);
    if (!request.ok) return;
    expect(request.body.data.relationships.variant.data.id).toBe("102");
    expect(request.body.data.relationships.store.data.id).toBe("42");
    expect(request.body.data.attributes.checkout_data.custom).toEqual({
      organization_id: "00000000-0000-4000-8000-000000000001",
    });
    expect(request.body.data.attributes.product_options.redirect_url).toBe(
      "https://app.example.test/app/acme/billing?checkout=complete",
    );
  });

  it("rejects a missing server variant instead of accepting a browser-supplied id", () => {
    const request = buildCheckoutRequest({
      organizationId: "00000000-0000-4000-8000-000000000001",
      orgSlug: "acme",
      email: "owner@example.com",
      planCode: "starter",
    }, { ...config, variantIds: { ...config.variantIds, starter: undefined } });

    expect(request).toEqual({ ok: false, code: "BILLING_PLAN_UNAVAILABLE" });
  });

  it("does not make a provider call when billing is not configured", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const result = await createLemonSqueezyCheckout(
      {
        organizationId: "00000000-0000-4000-8000-000000000001",
        orgSlug: "acme",
        email: "owner@example.com",
        planCode: "starter",
      },
      fetchMock,
    );

    expect(result).toEqual({ status: "unconfigured", code: "BILLING_NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns only the checkout URL from a valid provider response", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
    vi.stubEnv("LEMON_SQUEEZY_API_KEY", "fixture-api-key");
    vi.stubEnv("LEMON_SQUEEZY_STORE_ID", "42");
    vi.stubEnv("LEMON_SQUEEZY_STARTER_VARIANT_ID", "101");

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { attributes: { url: "https://checkout.example.test/session" } } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await createLemonSqueezyCheckout(
      {
        organizationId: "00000000-0000-4000-8000-000000000001",
        orgSlug: "acme",
        email: "owner@example.com",
        planCode: "starter",
      },
      fetchMock,
    );

    expect(result).toEqual({ status: "ready", url: "https://checkout.example.test/session" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.lemonsqueezy.com/v1/checkouts");
    expect(init?.headers).toMatchObject({
      Accept: "application/vnd.api+json",
      Authorization: "Bearer fixture-api-key",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      data: { relationships: { variant: { data: { id: "101" } } } },
    });
  });
});
