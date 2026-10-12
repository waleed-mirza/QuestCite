import { createHmac } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  adminClient,
  cleanupUsers,
  createConfirmedUser,
  e2eEmail,
  generateVerificationLink,
  hasAuthFixtureEnv,
} from "./helpers/auth-fixtures";

const JOURNEY_ENABLED = hasAuthFixtureEnv();
const WEBHOOK_SECRET = "fake-webhook-secret-for-e2e";

test.describe("Week 8 billing journey", () => {
  test.skip(!JOURNEY_ENABLED, "requires SUPABASE_SERVICE_ROLE_KEY + redirect allowlist + E2E_AUTH_JOURNEY=1");

  const slugSuffix = Date.now().toString(36);
  const ownerEmail = e2eEmail("billing-owner");
  const orgName = `Billing Org ${slugSuffix}`;
  const orgSlug = `billing-org-${slugSuffix}`;

  test("trial limit → upgrade prompt → webhook → paid entitlement", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext();
    const owner = await context.newPage();

    await createConfirmedUser(ownerEmail);
    await owner.goto(await generateVerificationLink(ownerEmail, "http://localhost:3100/auth/callback?next=/onboarding"));
    await expect(owner).toHaveURL(/\/onboarding/, { timeout: 30_000 });
    await owner.getByLabel("Workspace name").fill(orgName);
    await owner.getByRole("button", { name: "Create workspace" }).click();
    await expect(owner).toHaveURL(new RegExp(`/app/${orgSlug}$`));

    const organization = await adminClient().from("organizations").select("id").eq("slug", orgSlug).single();
    if (organization.error !== null || organization.data === null) throw new Error("billing journey organization lookup failed");
    const organizationId = organization.data.id;
    const periodStart = `${new Date().toISOString().slice(0, 7)}-01`;
    const usage = await adminClient().from("usage_counters").upsert({
      organization_id: organizationId,
      period_start: periodStart,
      metric: "ai_drafts",
      used: 25,
    });
    if (usage.error !== null) throw new Error("billing journey usage fixture failed");

    await owner.goto(`/app/${orgSlug}/billing`);
    await expect(owner.getByText("Trial", { exact: true })).toBeVisible();
    await expect(owner.getByText(/25 \/ 25/)).toBeVisible();
    const billingA11y = await new AxeBuilder({ page: owner }).analyze();
    expect(billingA11y.violations, JSON.stringify(billingA11y.violations, null, 2)).toEqual([]);

    await owner.getByRole("button", { name: "Choose Starter" }).click();
    await expect(owner.locator('p[role="alert"]')).toContainText("not configured");

    const payload = JSON.stringify({
      meta: {
        event_name: "subscription_created",
        custom_data: { organization_id: organizationId },
      },
      data: {
        type: "subscriptions",
        id: `e2e-sub-${slugSuffix}`,
        attributes: {
          store_id: 42,
          customer_id: `e2e-customer-${slugSuffix}`,
          order_id: `e2e-order-${slugSuffix}`,
          product_id: "e2e-product",
          variant_id: 101,
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          test_mode: true,
          urls: {
            customer_portal: "https://billing.example.test/portal",
            update_payment_method: "https://billing.example.test/payment",
          },
        },
      },
    });
    const signature = createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
    const webhook = await owner.request.post("/api/webhooks/lemonsqueezy", {
      data: payload,
      headers: { "x-signature": signature, "content-type": "application/json" },
    });
    expect(webhook.status()).toBe(200);
    expect(await webhook.json()).toMatchObject({ status: "accepted", duplicate: false });

    await owner.reload();
    await expect(owner.getByRole("heading", { name: "Starter", exact: true })).toBeVisible();
    await expect(owner.getByText(/25 \/ 250/)).toBeVisible();
    await expect(owner.getByRole("link", { name: "Open customer portal" })).toBeVisible();
    const paidA11y = await new AxeBuilder({ page: owner }).analyze();
    expect(paidA11y.violations, JSON.stringify(paidA11y.violations, null, 2)).toEqual([]);

    await owner.goto(`/app/${orgSlug}/settings`);
    await expect(owner.getByRole("heading", { name: "Workspace settings" })).toBeVisible();
    const settingsA11y = await new AxeBuilder({ page: owner }).analyze();
    expect(settingsA11y.violations, JSON.stringify(settingsA11y.violations, null, 2)).toEqual([]);
    await context.close();
  });

  test.afterAll(async () => {
    if (!hasAuthFixtureEnv()) return;
    await adminClient().from("organizations").delete().eq("slug", orgSlug);
    await cleanupUsers();
  });
});
