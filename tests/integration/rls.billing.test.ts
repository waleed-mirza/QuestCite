/**
 * Billing entitlement, quota, webhook, and RLS matrix (Week 8).
 *
 * This suite deliberately exercises the hosted database through real anon and
 * authenticated sessions. Webhook processing is the one service-role-only
 * boundary, so those calls use the provisioning client and then verify the
 * customer-visible result through RLS.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/types/database.types";

import { expectError, expectErrorWithCode, expectNoRows, expectOk, expectRows } from "./helpers/assert";
import { getAdminClient, getAnonClient } from "./helpers/clients";
import {
  addMember,
  createOrgAs,
  createTestUser,
  disposeAll,
  signInAs,
  type TestUser,
} from "./helpers/fixtures";

type Client = Awaited<ReturnType<typeof signInAs>>;
type WebhookArgs = Database["public"]["Functions"]["process_billing_webhook"]["Args"];
type WebhookArgsNullable = Omit<
  WebhookArgs,
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

let orgA = "";
let orgB = "";
let ownerA!: TestUser;
let adminA!: TestUser;
let reviewerA!: TestUser;
let viewerA!: TestUser;
let ownerB!: TestUser;
let ownerAClient!: Client;
let reviewerAClient!: Client;
let viewerAClient!: Client;
let ownerBClient!: Client;
let anon!: Client;

beforeAll(async () => {
  anon = getAnonClient();
  ownerA = await createTestUser("billing-owner-a");
  adminA = await createTestUser("billing-admin-a");
  reviewerA = await createTestUser("billing-reviewer-a");
  viewerA = await createTestUser("billing-viewer-a");
  ownerB = await createTestUser("billing-owner-b");

  ownerAClient = await signInAs(ownerA);
  reviewerAClient = await signInAs(reviewerA);
  viewerAClient = await signInAs(viewerA);
  ownerBClient = await signInAs(ownerB);

  const suffix = Date.now().toString(36);
  orgA = await createOrgAs(ownerAClient, "Billing Org A", `billing-a-${suffix}`, { plan: "trial" });
  orgB = await createOrgAs(ownerBClient, "Billing Org B", `billing-b-${suffix}`, { plan: "trial" });
  await addMember(orgA, adminA.userId, "admin");
  await addMember(orgA, reviewerA.userId, "reviewer");
  await addMember(orgA, viewerA.userId, "viewer");
});

afterAll(async () => {
  await disposeAll();
});

function webhookArgs(overrides: Partial<WebhookArgsNullable> = {}): WebhookArgs {
  const args: WebhookArgsNullable = {
    p_provider_event_id: `evt-${crypto.randomUUID()}`,
    p_event_hash: "a".repeat(64),
    p_event_type: "subscription_created",
    p_organization_id: orgA,
    p_provider_subscription_id: "sub-billing-a",
    p_provider_invoice_id: null,
    p_customer_id: "cus-billing-a",
    p_store_id: "42",
    p_order_id: "order-billing-a",
    p_product_id: "product-billing-a",
    p_variant_id: "101",
    p_plan_code: "starter",
    p_status: "active",
    p_trial_ends_at: null,
    p_renews_at: "2026-10-01T00:00:00.000Z",
    p_ends_at: null,
    p_customer_portal_url: "https://billing.example.test/portal",
    p_update_payment_url: "https://billing.example.test/payment",
    p_test_mode: true,
    p_event_occurred_at: "2026-09-04T00:00:00.000Z",
    ...overrides,
  };
  // The generated Supabase Args type cannot represent nullable Postgres
  // parameters; the hosted RPC accepts the validated NULLs in this fixture.
  return args as WebhookArgs;
}

describe("plan visibility and fail-closed quota enforcement", () => {
  it("exposes only the public plan catalog and gives a new org the trial entitlement", async () => {
    expectNoRows(await anon.from("plan_entitlements").select("plan_code"), "anon plan catalog");

    const plans = await viewerAClient
      .from("plan_entitlements")
      .select("plan_code,monthly_ai_draft_limit")
      .order("plan_code");
    expectRows(plans, "authenticated plan catalog");
    expect((plans.data ?? []).length).toBe(5);

    const snapshot = await ownerAClient.rpc("get_billing_snapshot", { p_organization_id: orgA });
    expectOk(snapshot, "trial billing snapshot");
    expect(snapshot.data?.[0]?.plan_code).toBe("trial");
    expect(snapshot.data?.[0]?.ai_drafts_limit).toBe(25);
    expect(snapshot.data?.[0]?.ai_drafts_used).toBe(0);
  });

  it("denies an initial request that is larger than the entire trial limit", async () => {
    const result = await ownerAClient.rpc("consume_usage", {
      p_organization_id: orgA,
      p_metric: "ai_drafts",
      p_amount: 26,
    });
    expectOk(result, "initial over-limit usage request");
    expect(result.data?.[0]?.allowed).toBe(false);
    expect(result.data?.[0]?.used).toBe(0);
  });

  it("keeps quota atomic under concurrent calls and respects role and tenant boundaries", async () => {
    const calls = await Promise.all(
      Array.from({ length: 40 }, () =>
        ownerBClient.rpc("consume_usage", {
          p_organization_id: orgB,
          p_metric: "ai_drafts",
          p_amount: 1,
        }),
      ),
    );
    const allowed = calls.filter((result) => result.error === null && result.data?.[0]?.allowed === true);
    expect(allowed).toHaveLength(25);

    const usage = await ownerBClient
      .from("usage_counters")
      .select("used,metric")
      .eq("organization_id", orgB)
      .eq("metric", "ai_drafts");
    expectRows(usage, "owner reads own usage");
    expect(usage.data?.[0]?.used).toBe(25);

    expectErrorWithCode(
      await viewerAClient.rpc("consume_usage", {
        p_organization_id: orgA,
        p_metric: "ai_drafts",
        p_amount: 1,
      }),
      "FORBIDDEN",
      "viewer consumes AI quota",
    );
    expectErrorWithCode(
      await ownerAClient.rpc("consume_usage", {
        p_organization_id: orgB,
        p_metric: "ai_drafts",
        p_amount: 1,
      }),
      "FORBIDDEN",
      "cross-tenant quota consume",
    );
  });
});

describe("signed webhook transaction boundary", () => {
  it("is service-role-only and syncs a subscription idempotently", async () => {
    const admin = getAdminClient();
    const first = await admin.rpc("process_billing_webhook", webhookArgs());
    expectOk(first, "process subscription created");
    expect(first.data?.[0]).toMatchObject({ accepted: true, duplicate: false, out_of_order: false });

    const duplicateEventId = `evt-billing-${crypto.randomUUID()}`;
    const duplicate = await admin.rpc("process_billing_webhook", webhookArgs({
      p_provider_event_id: duplicateEventId,
      p_event_hash: "b".repeat(64),
    }));
    expectOk(duplicate, "process distinct event");
    const sameEvent = await admin.rpc("process_billing_webhook", webhookArgs({
      p_provider_event_id: duplicateEventId,
      p_event_hash: "b".repeat(64),
    }));
    expectOk(sameEvent, "replay webhook event");
    expect(sameEvent.data?.[0]).toMatchObject({ accepted: true, duplicate: true });

    const subscription = await ownerAClient
      .from("subscriptions")
      .select("plan_code,status,customer_portal_url,update_payment_url")
      .eq("organization_id", orgA)
      .single();
    expectOk(subscription, "owner reads subscription");
    expect(subscription.data).toMatchObject({
      plan_code: "starter",
      status: "active",
      customer_portal_url: "https://billing.example.test/portal",
      update_payment_url: "https://billing.example.test/payment",
    });

    expectNoRows(
      await reviewerAClient.from("subscriptions").select().eq("organization_id", orgA),
      "reviewer reads subscription",
    );
    expectError(
      await ownerAClient.from("billing_webhook_events").select(),
      "owner reads webhook inbox",
    );
    expectError(
      await ownerAClient.rpc("process_billing_webhook", webhookArgs()),
      "owner processes webhook",
    );
    expectError(
      await anon.rpc("process_billing_webhook", webhookArgs()),
      "anon processes webhook",
    );
  });

  it("ignores out-of-order lifecycle events and fails closed for payment failure", async () => {
    const admin = getAdminClient();
    const old = await admin.rpc("process_billing_webhook", webhookArgs({
      p_provider_event_id: `evt-billing-${crypto.randomUUID()}`,
      p_event_hash: "c".repeat(64),
      p_event_type: "subscription_cancelled",
      p_status: "cancelled",
      p_event_occurred_at: "2026-09-03T00:00:00.000Z",
      p_ends_at: "2026-12-01T00:00:00.000Z",
    }));
    expectOk(old, "out-of-order lifecycle event");
    expect(old.data?.[0]).toMatchObject({ accepted: true, out_of_order: true });

    const failed = await admin.rpc("process_billing_webhook", webhookArgs({
      p_provider_event_id: `evt-billing-${crypto.randomUUID()}`,
      p_event_hash: "d".repeat(64),
      p_event_type: "subscription_payment_failed",
      p_status: "past_due",
      p_event_occurred_at: "2026-09-05T00:00:00.000Z",
    }));
    expectOk(failed, "payment failure event");

    const failedSnapshot = await ownerAClient.rpc("get_billing_snapshot", { p_organization_id: orgA });
    expectOk(failedSnapshot, "past due billing snapshot");
    expect(failedSnapshot.data?.[0]).toMatchObject({ plan_code: "free", subscription_status: "past_due" });

    const recovered = await admin.rpc("process_billing_webhook", webhookArgs({
      p_provider_event_id: `evt-billing-${crypto.randomUUID()}`,
      p_event_hash: "e".repeat(64),
      p_event_type: "subscription_payment_recovered",
      p_status: "active",
      p_event_occurred_at: "2026-09-06T00:00:00.000Z",
    }));
    expectOk(recovered, "payment recovery event");
    const recoveredSnapshot = await ownerAClient.rpc("get_billing_snapshot", { p_organization_id: orgA });
    expectOk(recoveredSnapshot, "recovered billing snapshot");
    expect(recoveredSnapshot.data?.[0]).toMatchObject({ plan_code: "starter", subscription_status: "active" });

    const cancelled = await admin.rpc("process_billing_webhook", webhookArgs({
      p_provider_event_id: `evt-billing-${crypto.randomUUID()}`,
      p_event_hash: "f".repeat(64),
      p_event_type: "subscription_cancelled",
      p_status: "cancelled",
      p_ends_at: "2026-12-01T00:00:00.000Z",
      p_event_occurred_at: "2026-09-07T00:00:00.000Z",
    }));
    expectOk(cancelled, "cancellation event");
    const cancelledSnapshot = await ownerAClient.rpc("get_billing_snapshot", { p_organization_id: orgA });
    expectOk(cancelledSnapshot, "cancelled billing snapshot");
    expect(cancelledSnapshot.data?.[0]).toMatchObject({ plan_code: "starter", subscription_status: "cancelled" });

    const expired = await admin.rpc("process_billing_webhook", webhookArgs({
      p_provider_event_id: `evt-billing-${crypto.randomUUID()}`,
      p_event_hash: "1".repeat(64),
      p_event_type: "subscription_expired",
      p_status: "expired",
      p_ends_at: "2026-09-08T00:00:00.000Z",
      p_event_occurred_at: "2026-09-08T00:00:00.000Z",
    }));
    expectOk(expired, "expired event");
    const expiredSnapshot = await ownerAClient.rpc("get_billing_snapshot", { p_organization_id: orgA });
    expectOk(expiredSnapshot, "expired billing snapshot");
    expect(expiredSnapshot.data?.[0]).toMatchObject({ plan_code: "free", subscription_status: "expired" });

    const resumed = await admin.rpc("process_billing_webhook", webhookArgs({
      p_provider_event_id: `evt-billing-${crypto.randomUUID()}`,
      p_event_hash: "2".repeat(64),
      p_event_type: "subscription_resumed",
      p_status: "active",
      p_event_occurred_at: "2026-09-09T00:00:00.000Z",
    }));
    expectOk(resumed, "resumed event");
    const resumedSnapshot = await ownerAClient.rpc("get_billing_snapshot", { p_organization_id: orgA });
    expectOk(resumedSnapshot, "resumed billing snapshot");
    expect(resumedSnapshot.data?.[0]).toMatchObject({ plan_code: "starter", subscription_status: "active" });
  });
});
