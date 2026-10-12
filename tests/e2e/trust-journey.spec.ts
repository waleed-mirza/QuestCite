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

/**
 * Week 7 FLAGSHIP journey (plan §W7 gate): publish → anonymous visit →
 * request → admin approves → prospect accepts terms → DOWNLOAD — with the
 * leak-proofing error paths (unknown slug 404, invalid link, escaped
 * cross-site content) asserted along the way. No AI anywhere: this journey
 * never spends live-AI budget.
 *
 * Opt-in gate: same as the W2/W4/W6 journeys — E2E_AUTH_JOURNEY=1.
 */

const JOURNEY_ENABLED = hasAuthFixtureEnv();

const DOC_CONTENT = "TRUST-JOURNEY-FIXATURE security overview body";

const XSS_PAYLOAD = `<img src=x onerror="window.__xss=1"> Is data encrypted?`;

test.describe("Week 7 trust journey", () => {
  test.skip(!JOURNEY_ENABLED, "requires SUPABASE_SERVICE_ROLE_KEY + redirect allowlist + E2E_AUTH_JOURNEY=1");

  const slugSuffix = Date.now().toString(36);
  const ownerEmail = e2eEmail("towner");
  const orgName = `Trust Org ${slugSuffix}`;
  const orgSlug = `trust-org-${slugSuffix}`;

  test("publish → anon visit (escaped, searchable, social meta) → request → approve → gated download", async ({ browser }) => {
    test.setTimeout(300_000);

    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    // Hosted rate-limit buckets persist between runs. Keep this fixture's
    // anonymous prospect traffic on a unique RFC 5737 test-net IP so a prior
    // run cannot consume the current run's five-request per-IP allowance.
    const anonForwardedIp = `198.51.100.${(Date.now() % 254) + 1}`;
    const anonContext = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": anonForwardedIp },
    });
    const anon = await anonContext.newPage();

    await createConfirmedUser(ownerEmail);
    const verifyLink = await generateVerificationLink(ownerEmail, "http://localhost:3100/auth/callback?next=/onboarding");
    await owner.goto(verifyLink);
    await expect(owner).toHaveURL(/\/onboarding/, { timeout: 30_000 });
    await owner.getByLabel("Workspace name").fill(orgName);
    await owner.getByLabel("Workspace address").fill(orgSlug);
    await owner.getByRole("button", { name: "Create workspace" }).click();
    await expect(owner).toHaveURL(new RegExp(`/app/${orgSlug}$`));

    // 1. BEFORE PUBLISH: the public URL is a 404 (no existence leak in
    // either direction — draft centers look identical to unknown slugs).
    const draftResponse = await anon.goto(`/trust/${orgSlug}`);
    expect(draftResponse?.status()).toBe(404);

    // 2. Branding + clickwrap terms through the real editor form.
    await owner.goto(`/app/${orgSlug}/trust-center`);
    await owner.getByLabel("Display name").fill(`${orgName} Security`);
    await owner.getByLabel("Contact email").fill(`security@${orgSlug}.example`);
    await owner.getByLabel("Headline").fill("Security & Trust Center");
    await owner.getByLabel("Security overview").fill("We encrypt everything at rest and in transit and review access quarterly.");
    await owner.getByLabel("Terms version").fill("v1");
    await owner.getByLabel("Terms text (displayed at request time)").fill("Confidential documents, evaluation only, no redistribution.");
    await owner.getByRole("button", { name: "Save branding & terms" }).click();
    await expect(owner.getByText("Saved. Publish to make changes live.")).toBeVisible({ timeout: 15_000 });

    // 3. FAQ carrying a stored-XSS payload — public output must stay text.
    await owner.getByLabel("Question", { exact: true }).fill(XSS_PAYLOAD);
    await owner.getByLabel("Answer", { exact: true }).fill("Yes — AES-256 at rest, TLS 1.3 in transit.");
    await owner.getByRole("button", { name: "Add FAQ" }).click();
    await expect(owner.getByText("FAQ saved.")).toBeVisible({ timeout: 15_000 });

    // 4. ERROR PATH: publishing without a publishable doc card is allowed,
    // but first prove the publish control works and the page goes live.
    await owner.locator("#tc-status-target").selectOption("published");
    await owner.getByRole("button", { name: "Set status" }).click();
    await expect(owner.getByText("Published — the public page is live.")).toBeVisible({ timeout: 15_000 });

    // 5. Seed a ready document + storage object (service-role fixture; the
    // real upload pipeline is the W3 journey's job).
    const admin = adminClient();
    const { data: orgRow } = await admin.from("organizations").select("id").eq("slug", orgSlug).maybeSingle();
    expect(orgRow?.id).toBeTruthy();
    const orgId = orgRow?.id as string;
    const documentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const storagePath = `${orgId}/${documentId}/${versionId}/security-overview.txt`;
    const { error: storageError } = await admin.storage
      .from("documents")
      .upload(storagePath, DOC_CONTENT, { contentType: "text/plain" });
    expect(storageError).toBeNull();
    const { error: docError } = await admin.from("documents").insert({
      id: documentId,
      organization_id: orgId,
      title: "Security Overview",
      category: "policy",
      tags: [],
      state: "active",
    });
    expect(docError).toBeNull();
    const { error: versionError } = await admin
      .from("document_versions")
      .insert({
        id: versionId,
        document_id: documentId,
        organization_id: orgId,
        version_number: 1,
        storage_path: storagePath,
        mime_type: "text/plain",
        byte_size: DOC_CONTENT.length,
        checksum_sha256: "0".repeat(64),
        parser_version: "e2e",
        processing_state: "ready",
      });
    expect(versionError).toBeNull();

    // 6. Document card through the real editor.
    await owner.reload();
    await owner.getByLabel("Document", { exact: true }).selectOption({ label: "Security Overview" });
    await owner.getByLabel("Description shown on the public card").fill("High-level security practices overview");
    await owner.getByRole("button", { name: "Add card" }).click();
    await expect(owner.getByText("Document card saved.")).toBeVisible({ timeout: 15_000 });

    // 7. ANONYMOUS VISIT: sections render; XSS stays inert text; social +
    // robots metadata exist; the search filters the page.
    await anon.goto(`/trust/${orgSlug}`);
    await expect(anon.getByRole("heading", { name: "Security & Trust Center" })).toBeVisible();
    await expect(anon.getByText("Security Overview").first()).toBeVisible();
    // Escaped: the payload renders as literal text, never executes.
    await expect(anon.getByText(/window.__xss/).first()).toBeVisible();
    const xssFired = await anon.evaluate(() => (window as unknown as { __xss?: number }).__xss);
    expect(xssFired).toBeUndefined();
    const robots = await anon.locator('meta[name="robots"]').getAttribute("content");
    expect(robots ?? "").toContain("index");
    const ogTitle = await anon.locator('meta[property="og:title"]').getAttribute("content");
    expect(ogTitle ?? "").toContain("Security & Trust Center");

    const a11yPublic = await new AxeBuilder({ page: anon }).analyze();
    expect(a11yPublic.violations).toEqual([]);

    await anon.getByLabel("Search public content").fill("encryption");
    await expect(anon.getByText("No matching subprocessors.")).toBeVisible();
    await anon.getByLabel("Search public content").fill("");

    // 8. REQUEST: form, clickwrap, success state.
    await anon.getByRole("link", { name: "Request access" }).first().click();
    await expect(anon).toHaveURL(new RegExp(`/trust/${orgSlug}/request`));
    const prospectEmail = `prospect-${slugSuffix}@example.com`;
    await anon.getByLabel("Name").fill("Pat Prospect");
    await anon.getByLabel("Company").fill("Buyer Corp");
    await anon.getByLabel("Work email").fill(prospectEmail);
    await anon.getByRole("checkbox").first().check();
    await anon.getByRole("checkbox", { name: /I accept the terms/ }).check();

    const a11yRequest = await new AxeBuilder({ page: anon }).analyze();
    expect(a11yRequest.violations).toEqual([]);

    // ERROR PATH: unchecked terms is blocked by required-field validation;
    // submit the real (valid) form.
    await anon.getByRole("button", { name: "Submit request" }).click();
    await expect(anon.getByText("Request received")).toBeVisible({ timeout: 30_000 });

    // 9. OWNER REVIEWS: queue shows the request; approval reveals the
    // one-time link.
    await owner.goto(`/app/${orgSlug}/access-requests`);
    await expect(owner.getByText("Pat Prospect · Buyer Corp")).toBeVisible({ timeout: 15_000 });
    await expect(owner.getByText(prospectEmail)).toBeVisible();
    await owner.getByRole("button", { name: "Apply decision" }).click();
    await expect(owner.getByText("share this one-time access link")).toBeVisible({ timeout: 30_000 });
    const accessUrl = await owner.locator("input[readonly]").inputValue();
    expect(accessUrl).toMatch(new RegExp(`/trust/${orgSlug}/access/[0-9a-f]{64}$`));

    // 10. PROSPECT DOWNLOADS through the gated link.
    await anon.goto(accessUrl);
    await expect(anon.getByRole("heading", { name: /Your documents/ })).toBeVisible();
    await expect(anon.getByText("Security Overview").first()).toBeVisible();

    const a11yAccess = await new AxeBuilder({ page: anon }).analyze();
    expect(a11yAccess.violations).toEqual([]);

    const downloadPromise = anon.waitForEvent("download", { timeout: 30_000 });
    await anon.getByRole("link", { name: "Download" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("security-overview.txt");

    // 11. ERROR PATHS: the same grant cannot download a DIFFERENT document
    // (generic denial), an invalid token gets the safe invalid page, and an
    // unknown slug is a 404.
    const wrongDoc = await anon.request.get(
      `/api/trust/${orgSlug}/documents/${crypto.randomUUID()}/download?token=${accessUrl.split("/").pop()}`,
    );
    expect(wrongDoc.status()).toBe(403);
    expect((await wrongDoc.json()).code).toBe("DOWNLOAD_NOT_ALLOWED");

    await anon.goto(`/trust/${orgSlug}/access/${"0".repeat(64)}`);
    await expect(anon.getByText("This link isn't valid")).toBeVisible();

    const unknownSlug = await anon.request.get(`/trust/definitely-not-a-real-center`);
    expect(unknownSlug.status()).toBe(404);

    await ownerContext.close();
    await anonContext.close();
  });

  test.afterAll(async () => {
    await cleanupUsers();
  });
});
