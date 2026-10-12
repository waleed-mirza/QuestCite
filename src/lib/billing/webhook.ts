import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { BillingPlanCode } from "@/config/plans";

const SUPPORTED_EVENTS = [
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

export type LemonEventName = (typeof SUPPORTED_EVENTS)[number];

export type BillingSubscriptionStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "cancelled"
  | "expired";

const identifierSchema = z
  .union([z.string().trim().min(1), z.number().int().nonnegative()])
  .transform(String);

const nullableDateSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), "invalid provider date")
  .nullable()
  .optional();

const nullableUrlSchema = z
  .union([
    z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .pipe(z.url().nullable()),
    z.null(),
  ])
  .optional();

const attributesSchema = z
  .object({
    store_id: identifierSchema.optional(),
    customer_id: identifierSchema.optional(),
    order_id: identifierSchema.optional(),
    product_id: identifierSchema.optional(),
    variant_id: identifierSchema.optional(),
    subscription_id: identifierSchema.optional(),
    status: z.string().trim().min(1).optional(),
    cancelled: z.boolean().optional(),
    trial_ends_at: nullableDateSchema,
    renews_at: nullableDateSchema,
    ends_at: nullableDateSchema,
    created_at: nullableDateSchema,
    updated_at: nullableDateSchema,
    test_mode: z.boolean().optional(),
    urls: z
      .object({
        customer_portal: nullableUrlSchema,
        customer_portal_update_subscription: nullableUrlSchema,
        update_payment_method: nullableUrlSchema,
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const billingWebhookPayloadSchema = z
  .object({
    meta: z
      .object({
        event_name: z.enum(SUPPORTED_EVENTS),
        custom_data: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
    data: z
      .object({
        type: z.union([z.literal("subscriptions"), z.literal("subscription-invoices")]),
        id: z.string().trim().min(1).max(200),
        attributes: attributesSchema,
      })
      .passthrough(),
  })
  .passthrough();

export type BillingWebhookPayload = z.infer<typeof billingWebhookPayloadSchema>;

export type ParsedLemonSqueezyWebhook = {
  eventType: LemonEventName;
  eventOccurredAt: string | null;
  organizationId: string | null;
  providerEventResourceId: string;
  providerSubscriptionId: string;
  providerInvoiceId: string | null;
  customerId: string | null;
  storeId: string | null;
  orderId: string | null;
  productId: string | null;
  variantId: string | null;
  planCode: BillingPlanCode | null;
  status: BillingSubscriptionStatus;
  trialEndsAt: string | null;
  renewsAt: string | null;
  endsAt: string | null;
  customerPortalUrl: string | null;
  updatePaymentUrl: string | null;
  testMode: boolean;
  eventHash: string;
};

export function verifyLemonSqueezySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (signature === null || secret === "" || !/^[0-9a-f]{64}$/i.test(signature)) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const suppliedBytes = Buffer.from(signature, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

export function parseLemonSqueezyWebhook(
  rawBody: string,
  options: { variantToPlan: ReadonlyMap<string, BillingPlanCode> },
): ParsedLemonSqueezyWebhook {
  let input: unknown;
  try {
    input = JSON.parse(rawBody) as unknown;
  } catch {
    throw new Error("BILLING_PAYLOAD_INVALID");
  }

  const parsed = billingWebhookPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("BILLING_PAYLOAD_INVALID");
  }

  const { data, meta } = parsed.data;
  const attributes = data.attributes;
  const eventType = meta.event_name;
  const isSubscription = data.type === "subscriptions";
  const subscriptionId = isSubscription ? data.id : attributes.subscription_id;
  if (subscriptionId === undefined) {
    throw new Error("BILLING_SUBSCRIPTION_ID_MISSING");
  }

  const variantId = attributes.variant_id ?? null;
  const planCode = variantId === null ? null : options.variantToPlan.get(variantId) ?? null;
  if (isSubscription && planCode === null) {
    throw new Error("BILLING_VARIANT_UNKNOWN");
  }

  const eventOccurredAt = attributes.updated_at ?? attributes.created_at ?? null;
  const status = mapLemonEventToStatus(eventType, attributes.status ?? "", attributes.cancelled ?? false);
  const urls = attributes.urls;
  const customerPortalUrl = urls?.customer_portal ?? urls?.customer_portal_update_subscription ?? null;
  const eventHash = createHash("sha256").update(rawBody, "utf8").digest("hex");

  return {
    eventType,
    eventOccurredAt: eventOccurredAt ?? null,
    organizationId: readOrganizationId(meta.custom_data),
    providerEventResourceId: data.id,
    providerSubscriptionId: subscriptionId,
    providerInvoiceId: isSubscription ? null : data.id,
    customerId: attributes.customer_id ?? null,
    storeId: attributes.store_id ?? null,
    orderId: attributes.order_id ?? null,
    productId: attributes.product_id ?? null,
    variantId,
    planCode,
    status,
    trialEndsAt: attributes.trial_ends_at ?? null,
    renewsAt: attributes.renews_at ?? null,
    endsAt: attributes.ends_at ?? null,
    customerPortalUrl,
    updatePaymentUrl: urls?.update_payment_method ?? null,
    testMode: attributes.test_mode ?? false,
    eventHash,
  };
}

export function eventIdForLemonPayload(event: ParsedLemonSqueezyWebhook): string {
  // The provider payload has no stable event UUID.
  // The body hash is therefore the collision-resistant local event identity;
  // the full normalized payload is still stored separately for diagnostics.
  return `lemon:${event.eventHash}`;
}

export function mapLemonEventToStatus(
  eventName: string,
  providerStatus: string,
  cancelled = false,
): BillingSubscriptionStatus {
  switch (eventName) {
    case "subscription_payment_failed":
      return "past_due";
    case "subscription_payment_success":
    case "subscription_payment_recovered":
    case "subscription_resumed":
    case "subscription_unpaused":
      return "active";
    case "subscription_paused":
      return "paused";
    case "subscription_cancelled":
      return "cancelled";
    case "subscription_expired":
      return "expired";
    case "subscription_created":
    case "subscription_updated":
    case "subscription_plan_changed":
      if (cancelled || providerStatus === "cancelled") return "cancelled";
      if (providerStatus === "on_trial" || providerStatus === "trialing") return "trialing";
      if (providerStatus === "past_due") return "past_due";
      if (providerStatus === "paused") return "paused";
      if (providerStatus === "expired") return "expired";
      return "active";
    default:
      throw new Error("BILLING_EVENT_UNSUPPORTED");
  }
}

function readOrganizationId(customData: Record<string, unknown> | undefined): string | null {
  const value = customData?.organization_id;
  return typeof value === "string" && z.uuid().safeParse(value).success ? value : null;
}
