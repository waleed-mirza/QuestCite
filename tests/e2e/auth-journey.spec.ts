import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  E2E_PASSWORD,
  adminClient,
  cleanupUsers,
  createConfirmedUser,
  e2eEmail,
  generateVerificationLink,
  hasAuthFixtureEnv,
} from "./helpers/auth-fixtures";

/**
 * Plan §W2 E2E: signup -> verify fixture -> onboarding -> invite -> switch
 * organization -> logout, against the hosted project (D016).
 *
 * Opt-in gate: the journey needs (a) SUPABASE_SERVICE_ROLE_KEY for the
 * admin-API fixture (D016/D020 — verification links are minted, never emailed)
 * and (b) the hosted project's redirect allowlist to contain the test
 * origin's /auth/callback (owner dashboard action). CI enables this only when
 * RUN_HOSTED_E2E and ALLOW_HOSTED_TEST_MUTATIONS are explicitly configured;
 * locally run with E2E_AUTH_JOURNEY=1 once (b) is done.
 */

const JOURNEY_ENABLED = hasAuthFixtureEnv();

test.describe("Week 2 authenticated journey", () => {
  test.skip(!JOURNEY_ENABLED, "requires SUPABASE_SERVICE_ROLE_KEY + redirect allowlist + E2E_AUTH_JOURNEY=1");

  const slugSuffix = Date.now().toString(36);
  const ownerEmail = e2eEmail("owner");
  const inviteeEmail = e2eEmail("invitee");
  // Suffix in the NAME keeps derived slugs collision-free across reruns on
  // the persistent hosted database.
  const orgName = `Journey Org ${slugSuffix}`;
  const orgSlug = `journey-org-${slugSuffix}`;
  const inviteeOrgName = `Invitee Org ${slugSuffix}`;
  const inviteeOrgSlug = `invitee-org-${slugSuffix}`;
  const APP_URL = "http://localhost:3100";

  test("signup → verify → onboarding → invite → accept → switch → knowledge base → logout", async ({ browser }) => {
    test.setTimeout(180_000);
    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();

    // 1+2. "Signup → verify": the account is provisioned via the admin API
    // (email confirmations are ON and the built-in email rate-limits real
    // signups — D020), then enters through the REAL PKCE /auth/callback via
    // a generated link. The signup form UI itself is covered by smoke tests.
    await createConfirmedUser(ownerEmail);
    const verifyLink = await generateVerificationLink(ownerEmail, `${APP_URL}/auth/callback?next=/onboarding`);
    await owner.goto(verifyLink);
    // The link bounces through /login (implicit fragment) where the client
    // handler validates the session against the auth server — allow for a
    // slow first roundtrip to the hosted region.
    await expect(owner).toHaveURL(/\/onboarding/, { timeout: 30_000 });
    await expect(owner.getByRole("heading", { name: "Create your workspace" })).toBeVisible();

    // 3. Onboarding: atomic org creation → lands in the org shell as owner.
    await owner.getByLabel("Workspace name").fill(orgName);
    const slugField = owner.getByLabel("Workspace address");
    await expect(slugField).toHaveValue(orgSlug);
    await owner.getByRole("button", { name: "Create workspace" }).click();
    await expect(owner).toHaveURL(new RegExp(`/app/${orgSlug}$`));
    await expect(owner.getByRole("heading", { name: orgName, level: 1 })).toBeVisible();
    // Role appears in both the header and the switcher — target the header.
    await expect(owner.getByRole("banner").getByText("owner", { exact: true })).toBeVisible();

    // a11y on the two core authenticated surfaces (rule 11 / plan a11y gate).
    for (const path of [`/app/${orgSlug}`, `/app/${orgSlug}/members`]) {
      await owner.goto(path);
      const results = await new AxeBuilder({ page: owner }).analyze();
      expect(results.violations, `${path}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
    }

    // 4. Invite the second user (reviewer) — one-time link shown once.
    await createConfirmedUser(inviteeEmail);
    await owner.goto(`/app/${orgSlug}/members`);
    await owner.getByLabel("Email").fill(inviteeEmail);
    await owner.getByLabel("Role", { exact: true }).selectOption("reviewer");
    await owner.getByRole("button", { name: "Invite", exact: true }).click();
    const inviteLinkField = owner.getByLabel("One-time invite link (shown once)");
    await expect(inviteLinkField).toBeVisible();
    const invitePath = await inviteLinkField.inputValue();
    expect(invitePath).toContain("/invite/");

    // 5. Invitee signs in with a fresh session and accepts.
    const inviteeContext = await browser.newContext();
    const invitee = await inviteeContext.newPage();
    await invitee.goto("/login");
    await invitee.getByLabel("Work email").fill(inviteeEmail);
    await invitee.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await invitee.getByRole("button", { name: "Sign in" }).click();
    await expect(invitee).toHaveURL(/\/onboarding/); // no workspace yet → router shows creation form
    await invitee.goto(invitePath);
    await expect(invitee.getByText(orgName)).toBeVisible();
    await expect(invitee.getByText("reviewer")).toBeVisible();
    await invitee.getByRole("button", { name: "Accept invitation" }).click();
    await expect(invitee).toHaveURL(new RegExp(`/app/${orgSlug}`));

    // 6. Switch organization: invitee creates their own workspace, then
    // switches back to org A through the switcher (journey J2).
    await invitee.goto("/onboarding?new=1");
    await expect(invitee.getByRole("heading", { name: "Create your workspace" })).toBeVisible();
    await invitee.getByLabel("Workspace name").fill(inviteeOrgName);
    await expect(invitee.getByLabel("Workspace address")).toHaveValue(inviteeOrgSlug);
    await invitee.getByRole("button", { name: "Create workspace" }).click();
    await expect(invitee).toHaveURL(new RegExp(`/app/${inviteeOrgSlug}$`));
    await invitee.locator("summary").click(); // org switcher dropdown
    await invitee.locator("details ul").getByRole("link", { name: new RegExp(orgName) }).click();
    await expect(invitee).toHaveURL(new RegExp(`/app/${orgSlug}$`));

    // 7. Knowledge base (W3): a supported upload always creates a library row
    // (processing may legitimately end in the safe `failed` state when no
    // embedding provider is configured in the test environment); unsupported
    // types are rejected BEFORE storage with the stable safe error copy.
    await owner.goto(`/app/${orgSlug}/documents`);
    await owner.getByLabel("Title").fill("Access Control Policy");
    // "Category" also labels the search-filter select — target the upload input.
    await owner.getByRole("textbox", { name: "Category" }).fill("policies");
    await owner
      .getByLabel("File (PDF, DOCX, TXT, MD — max 10 MB)")
      .setInputFiles({
        name: "access-control.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "Encryption: all customer data is encrypted at rest with AES-256.\n",
          "utf8",
        ),
      });
    await owner.getByRole("button", { name: "Upload" }).click();
    // Ingestion runs in-request (storage + parse + embed), so wait for the
    // form's SPECIFIC outcome copy — a bare role=alert matches Next's empty
    // route announcer instantly and would race the upload.
    await expect(
      owner
        .getByText("Document uploaded and searchable.")
        .or(owner.getByText("The file uploaded, but processing failed")),
    ).toBeVisible({ timeout: 30_000 });
    await owner.reload(); // fresh server render shows the new library row
    await expect(owner.getByRole("link", { name: "Access Control Policy" })).toBeVisible({ timeout: 10_000 });

    // Title is required on every upload (noValidate form → server-side check),
    // so the rejection attempt needs the full metadata again.
    await owner.getByLabel("Title").fill("Malware Sample");
    await owner
      .getByLabel("File (PDF, DOCX, TXT, MD — max 10 MB)")
      .setInputFiles({
        name: "payload.exe",
        mimeType: "application/x-msdownload",
        buffer: Buffer.from("MZ — not a document", "utf8"),
      });
    await owner.getByRole("button", { name: "Upload" }).click();
    await expect(owner.getByText("That file type isn't supported")).toBeVisible();

    // Reviewers read the library but never see management controls (PRD §5).
    await invitee.goto(`/app/${orgSlug}/documents`);
    await expect(invitee.getByRole("heading", { name: "Upload a document" })).toHaveCount(0);
    await expect(invitee.getByRole("link", { name: "Access Control Policy" })).toBeVisible();

    // 8. Knowledge entries: create, then edit — the immutable history gains v2.
    await owner.goto(`/app/${orgSlug}/knowledge`);
    await owner.getByLabel("Question").fill("Is customer data encrypted at rest?");
    await owner.getByLabel("Answer").fill("Yes — AES-256 with managed keys.");
    await owner.getByLabel("Review state", { exact: true }).selectOption("approved");
    await owner.getByRole("button", { name: "Create entry" }).click();
    await expect(owner.getByText("Entry created.")).toBeVisible();
    await owner.getByRole("link", { name: "Is customer data encrypted at rest?" }).click();
    await owner.getByRole("button", { name: "Save as new version" }).click();
    await expect(owner.getByText("Entry saved as a new version.")).toBeVisible();
    await expect(owner.getByText("Version 2")).toBeVisible();

    // a11y on the two new W3 surfaces.
    for (const path of [`/app/${orgSlug}/documents`, `/app/${orgSlug}/knowledge`]) {
      await owner.goto(path);
      const results = await new AxeBuilder({ page: owner }).analyze();
      expect(results.violations, `${path}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
    }

    // 9. Logout (server action).
    await owner.getByRole("button", { name: "Sign out" }).click();
    await expect(owner).toHaveURL(/\/login/);

    await ownerContext.close();
    await inviteeContext.close();
  });

  test.afterAll(async () => {
    // Orgs cascade via user deletion? No — orgs are independent rows; delete
    // by slug through the admin client, then remove users.
    if (!hasAuthFixtureEnv()) return;
    const admin = adminClient();
    for (const slug of [orgSlug, inviteeOrgSlug]) {
      await admin.from("organizations").delete().eq("slug", slug);
    }
    await cleanupUsers();
  });
});
