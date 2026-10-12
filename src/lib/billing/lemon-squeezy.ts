import "server-only";

import { z } from "zod";

import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/observability/logger";
import { getPlanDefinition, isPaidPlanCode, type PaidPlanCode } from "@/config/plans";

const checkoutResponseSchema = z.object({
  data: z.object({
    attributes: z.object({ url: z.url() }),
  }),
});

export type CheckoutConfig = {
  apiKey: string | undefined;
  storeId: string | undefined;
  variantIds: Record<PaidPlanCode, string | undefined>;
  appUrl: string;
};

export type CheckoutInput = {
  organizationId: string;
  orgSlug: string;
  email: string;
  planCode: PaidPlanCode;
};

type CheckoutRequestBody = {
  data: {
    type: "checkouts";
    attributes: {
      checkout_data: {
        email: string;
        custom: { organization_id: string };
      };
      product_options: {
        redirect_url: string;
      };
    };
    relationships: {
      store: { data: { type: "stores"; id: string } };
      variant: { data: { type: "variants"; id: string } };
    };
  };
};

type CheckoutRequest = {
  ok: true;
  url: string;
  headers: { Accept: string; "Content-Type": string; Authorization: string };
  body: CheckoutRequestBody;
};

type CheckoutBuildError = {
  ok: false;
  code: "BILLING_PLAN_UNAVAILABLE" | "BILLING_PROVIDER_CONFIG_INVALID";
};

export type CheckoutBuildResult = CheckoutRequest | CheckoutBuildError;

export type CheckoutResult =
  | { status: "ready"; url: string }
  | { status: "unconfigured"; code: "BILLING_NOT_CONFIGURED" | "BILLING_PROVIDER_CONFIG_INVALID" | "BILLING_PLAN_UNAVAILABLE" }
  | { status: "failed"; code: "BILLING_PROVIDER_FAILED" };

function positiveInteger(value: string | undefined): value is string {
  return value !== undefined && /^\d+$/.test(value) && Number(value) > 0;
}

export function buildCheckoutRequest(input: CheckoutInput, config: CheckoutConfig): CheckoutBuildResult {
  if (!isPaidPlanCode(input.planCode)) {
    return { ok: false, code: "BILLING_PLAN_UNAVAILABLE" };
  }
  const variantId = config.variantIds[input.planCode];
  if (variantId === undefined) {
    return { ok: false, code: "BILLING_PLAN_UNAVAILABLE" };
  }
  if (!positiveInteger(config.storeId) || !positiveInteger(variantId)) {
    return { ok: false, code: "BILLING_PROVIDER_CONFIG_INVALID" };
  }

  const redirectUrl = `${config.appUrl.replace(/\/$/, "")}/app/${encodeURIComponent(input.orgSlug)}/billing?checkout=complete`;
  const body: CheckoutRequestBody = {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: {
          email: input.email,
          custom: { organization_id: input.organizationId },
        },
        product_options: { redirect_url: redirectUrl },
      },
      relationships: {
        store: { data: { type: "stores", id: config.storeId } },
        variant: { data: { type: "variants", id: variantId } },
      },
    },
  };

  if (config.apiKey === undefined) {
    return { ok: false, code: "BILLING_PROVIDER_CONFIG_INVALID" };
  }
  return {
    ok: true,
    url: "https://api.lemonsqueezy.com/v1/checkouts",
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body,
  };
}

function checkoutConfig(): CheckoutConfig {
  const env = getServerEnv();
  return {
    apiKey: env.LEMON_SQUEEZY_API_KEY,
    storeId: env.LEMON_SQUEEZY_STORE_ID,
    variantIds: {
      starter: env.LEMON_SQUEEZY_STARTER_VARIANT_ID,
      pro: env.LEMON_SQUEEZY_PRO_VARIANT_ID,
      agency: env.LEMON_SQUEEZY_AGENCY_VARIANT_ID,
    },
    appUrl: env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  };
}

export async function createLemonSqueezyCheckout(
  input: CheckoutInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckoutResult> {
  const definition = getPlanDefinition(input.planCode);
  if (definition === undefined || !isPaidPlanCode(input.planCode)) {
    return { status: "unconfigured", code: "BILLING_PLAN_UNAVAILABLE" };
  }

  const config = checkoutConfig();
  if (config.apiKey === undefined || config.storeId === undefined || config.variantIds[input.planCode] === undefined) {
    return { status: "unconfigured", code: "BILLING_NOT_CONFIGURED" };
  }
  const request = buildCheckoutRequest(input, config);
  if (!request.ok) {
    return { status: "unconfigured", code: request.code };
  }

  try {
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
    if (!response.ok) {
      logger.warn("billing.checkout.provider_failed", { status: response.status });
      return { status: "failed", code: "BILLING_PROVIDER_FAILED" };
    }
    const parsed: unknown = await response.json();
    const validated = checkoutResponseSchema.safeParse(parsed);
    if (!validated.success) {
      logger.warn("billing.checkout.response_invalid", { status: response.status });
      return { status: "failed", code: "BILLING_PROVIDER_FAILED" };
    }
    return { status: "ready", url: validated.data.data.attributes.url };
  } catch {
    logger.warn("billing.checkout.network_failed");
    return { status: "failed", code: "BILLING_PROVIDER_FAILED" };
  }
}
