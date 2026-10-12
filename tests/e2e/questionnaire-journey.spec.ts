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
 * Plan §W4 E2E: import → MAPPING CONFIRMATION → answer (autosave) → review
 * transition → RELOAD (persistence) → category edit → comment, against the
 * hosted project (D016). The mapping step is the product invariant under
 * test: questions exist only after the user explicitly confirms the column
 * mapping — detection only prefills.
 *
 * Opt-in gate: same as the W2 journey (admin-API fixtures + hosted redirect
 * allowlist) — see auth-journey.spec.ts.
 */

const JOURNEY_ENABLED = hasAuthFixtureEnv();

const QUESTION_1 = "Is data encrypted at rest?";
const QUESTION_2 = "Who can access production systems?";
const CSV_CONTENT = `Question,Answer\n${QUESTION_1},\n${QUESTION_2},\n`;

test.describe("Week 4 questionnaire journey", () => {
  test.skip(!JOURNEY_ENABLED, "requires SUPABASE_SERVICE_ROLE_KEY + redirect allowlist + E2E_AUTH_JOURNEY=1");

  const slugSuffix = Date.now().toString(36);
  const ownerEmail = e2eEmail("qowner");
  const orgName = `Questionnaire Org ${slugSuffix}`;
  const orgSlug = `questionnaire-org-${slugSuffix}`;

  test("import → map → confirm → answer → reload → category → comment", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext();
    const owner = await context.newPage();

    // Enter as a confirmed owner (admin-API fixture + real PKCE callback).
    await createConfirmedUser(ownerEmail);
    const verifyLink = await generateVerificationLink(ownerEmail, "http://localhost:3100/auth/callback?next=/onboarding");
    await owner.goto(verifyLink);
    await expect(owner).toHaveURL(/\/onboarding/, { timeout: 30_000 });
    await owner.getByLabel("Workspace name").fill(orgName);
    await expect(owner.getByLabel("Workspace address")).toHaveValue(orgSlug);
    await owner.getByRole("button", { name: "Create workspace" }).click();
    await expect(owner).toHaveURL(new RegExp(`/app/${orgSlug}$`));

    // 1. Import: upload the CSV through the real form.
    await owner.goto(`/app/${orgSlug}/questionnaires`);
    const results = await new AxeBuilder({ page: owner }).analyze();
    expect(results.violations, `list: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);

    await owner.getByLabel("Title").fill("Acme security questionnaire");
    await owner
      .getByLabel("File (.xlsx or .csv — max 10 MB)")
      .setInputFiles({
        name: "acme-questions.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(CSV_CONTENT, "utf8"),
      });
    await owner.getByRole("button", { name: "Continue to mapping" }).click();
    await expect(owner).toHaveURL(/\/mapping$/, { timeout: 30_000 });

    // 2. Mapping preview: detection prefilled, axe-clean, nothing imported yet.
    await expect(owner.getByText(/Ready to import 2 questions/)).toBeVisible({ timeout: 15_000 });
    const mappingResults = await new AxeBuilder({ page: owner }).analyze();
    expect(mappingResults.violations, `mapping: ${JSON.stringify(mappingResults.violations, null, 2)}`).toEqual([]);

    await owner.getByRole("button", { name: "Confirm mapping & import" }).click();
    await expect(owner).toHaveURL(/\/questionnaires\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(owner.getByText(QUESTION_1)).toBeVisible({ timeout: 15_000 });
    await expect(owner.getByText(QUESTION_2)).toBeVisible();
    await expect(owner.getByText("0 of 2 resolved")).toBeVisible();
    // W5 surface: the control is present and fails closed when the local/CI
    // deployment has no provider key; this journey never spends live-AI
    // budget.
    await expect(owner.getByRole("heading", { name: "AI drafting" })).toBeVisible();
    await expect(owner.getByText(/AI drafting is not configured|AI drafting is disabled|Generate drafts/).first()).toBeVisible();

    // 3. Answer with autosave: type, wait for the save, then submit for review.
    await owner.locator("tbody details").first().locator("summary").click();
    const answerField = owner.getByLabel("Answer", { exact: true }).first();
    await answerField.fill("AES-256 at rest, TLS 1.3 in transit.");
    await expect(owner.getByText("Saved")).toBeVisible({ timeout: 15_000 });
    await owner.getByRole("button", { name: "Submit for review" }).click();
    // The status FILTER also contains an "In review" <option> — assert on the
    // table cell, not the first text match.
    await expect(owner.getByRole("cell", { name: "In review", exact: true })).toBeVisible({ timeout: 15_000 });
    // The review action revalidated the page, so the header progress now
    // counts the answered question.
    await expect(owner.getByText("1 of 2 resolved")).toBeVisible({ timeout: 15_000 });

    // 4. Reload (plan §W4 E2E: edit → save → reload): answer text and status
    // must come from the server, never from client state.
    await owner.reload();
    await owner.locator("tbody details").first().locator("summary").click();
    await expect(owner.getByLabel("Answer", { exact: true }).first()).toHaveValue(
      "AES-256 at rest, TLS 1.3 in transit.",
    );
    await expect(owner.getByRole("cell", { name: "In review", exact: true })).toBeVisible();

    // 5. Category is an editable dimension (plan §W4 data table): set one and
    // read it back from the revalidated row cell. Scoped to the EXPANDED row
    // that holds the answer — every expanded row carries a "Category" label,
    // and the filter bar has one too.
    const answeredRow = owner.getByRole("cell", { name: /AES-256 at rest/ });
    await answeredRow.getByLabel("Category", { exact: true }).fill("Network");
    await answeredRow.getByRole("button", { name: "Save", exact: true }).click();
    await expect(owner.getByRole("cell", { name: "Network", exact: true })).toBeVisible({ timeout: 15_000 });

    // 6. Comment on the question.
    await owner.getByLabel("Add a comment").first().fill("Please cite the encryption policy here.");
    await owner.getByRole("button", { name: "Comment", exact: true }).first().click();
    await expect(owner.getByText("Please cite the encryption policy here.")).toBeVisible({ timeout: 15_000 });

    const detailResults = await new AxeBuilder({ page: owner }).analyze();
    expect(detailResults.violations, `detail: ${JSON.stringify(detailResults.violations, null, 2)}`).toEqual([]);

    await owner.getByRole("button", { name: "Sign out" }).click();
    await expect(owner).toHaveURL(/\/login/);

    await context.close();
  });

  test.afterAll(async () => {
    if (!hasAuthFixtureEnv()) return;
    await adminClient().from("organizations").delete().eq("slug", orgSlug);
    await cleanupUsers();
  });
});
