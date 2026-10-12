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
 * Week 6 FLAGSHIP journey (plan §W6 gate): upload → import → answer → bulk
 * review → approve → complete review → export → DOWNLOAD, with the
 * error/recovery path (export blocked until every question is resolved)
 * asserted along the way. Manual answers only — this journey never spends
 * live-AI budget (the live workflow verification is the flagged suite).
 *
 * Opt-in gate: same as the W2/W4 journeys (admin-API fixtures + hosted
 * redirect allowlist) — E2E_AUTH_JOURNEY=1.
 */

const JOURNEY_ENABLED = hasAuthFixtureEnv();

const QUESTION_1 = "Is data encrypted at rest?";
const QUESTION_2 = "Who can access production systems?";
const CSV_CONTENT = `Question,Answer\n${QUESTION_1},\n${QUESTION_2},\n`;

test.describe("Week 6 export journey", () => {
  test.skip(!JOURNEY_ENABLED, "requires SUPABASE_SERVICE_ROLE_KEY + redirect allowlist + E2E_AUTH_JOURNEY=1");

  const slugSuffix = Date.now().toString(36);
  const ownerEmail = e2eEmail("xowner");
  const orgName = `Export Org ${slugSuffix}`;
  const orgSlug = `export-org-${slugSuffix}`;

  test("import → answer → bulk review → approve → complete → export → download", async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext();
    const owner = await context.newPage();

    await createConfirmedUser(ownerEmail);
    const verifyLink = await generateVerificationLink(ownerEmail, "http://localhost:3100/auth/callback?next=/onboarding");
    await owner.goto(verifyLink);
    await expect(owner).toHaveURL(/\/onboarding/, { timeout: 30_000 });
    await owner.getByLabel("Workspace name").fill(orgName);
    await owner.getByRole("button", { name: "Create workspace" }).click();
    await expect(owner).toHaveURL(new RegExp(`/app/${orgSlug}$`));

    // 1. Import the CSV through the real form and confirm the mapping.
    await owner.goto(`/app/${orgSlug}/questionnaires`);
    await owner.getByLabel("Title").fill("Flagship export questionnaire");
    await owner
      .getByLabel("File (.xlsx or .csv — max 10 MB)")
      .setInputFiles({
        name: "flagship-questions.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(CSV_CONTENT, "utf8"),
      });
    await owner.getByRole("button", { name: "Continue to mapping" }).click();
    await expect(owner).toHaveURL(/\/mapping$/, { timeout: 30_000 });
    await expect(owner.getByText(/Ready to import 2 questions/)).toBeVisible({ timeout: 15_000 });
    await owner.getByRole("button", { name: "Confirm mapping & import" }).click();
    await expect(owner).toHaveURL(/\/questionnaires\/[0-9a-f-]{36}$/, { timeout: 30_000 });

    // 2. ERROR PATH: with unresolved questions the export control is blocked
    // and says why — nothing can be exported yet.
    const exportButton = owner.getByRole("button", { name: "Export answers" });
    await expect(exportButton).toBeDisabled({ timeout: 15_000 });
    await expect(owner.getByText(/still need a decision/)).toBeVisible();

    // 3. Answer both questions with autosave. Both editors are always in the
    // DOM (the expand control is purely visual), so the editor is scoped to
    // the sibling <tr> of its question row — never by document order.
    const rowFor = (question: string) =>
      owner.getByRole("row", { name: new RegExp(question.replace("?", "\\?")) }).first();
    const editorFor = (question: string) =>
      rowFor(question).locator("xpath=following-sibling::tr[1]").getByLabel("Answer", { exact: true });
    for (const [question, answer] of [
      [QUESTION_1, "AES-256 at rest, TLS 1.3 in transit."],
      [QUESTION_2, "Named admins only, quarterly access review."],
    ] as const) {
      await rowFor(question).locator("details").first().locator("summary").click();
      await editorFor(question).fill(answer);
      await expect(owner.getByText("Saved").last()).toBeVisible({ timeout: 15_000 });
    }

    // 4. BULK REVIEW: submit both, then approve both — all-or-nothing batch
    // actions through the real toolbar. The page revalidates between the two
    // batches, so the server-rendered checkboxes must be re-selected.
    const reviewDisclosure = owner.locator("details").filter({ hasText: "Bulk review…" });
    const openDisclosure = async () => {
      if (!(await reviewDisclosure.evaluate((element: HTMLElement) => (element as HTMLDetailsElement).open))) {
        await reviewDisclosure.locator("summary").click();
      }
    };
    const selectBoth = async () => {
      for (const question of [QUESTION_1, QUESTION_2]) {
        await rowFor(question).getByRole("checkbox").check();
      }
    };

    await openDisclosure();
    await selectBoth();
    await owner.getByLabel("Bulk review action").selectOption("in_review");
    await owner.getByRole("button", { name: "Apply to selected" }).click();
    await expect(owner.getByText(/2 answers moved to in review/)).toBeVisible({ timeout: 15_000 });
    await expect(owner.getByRole("cell", { name: "In review", exact: true })).toHaveCount(2);

    await openDisclosure();
    await selectBoth();
    await owner.getByLabel("Bulk review action").selectOption("approved");
    await owner.getByRole("button", { name: "Apply to selected" }).click();
    await expect(owner.getByText(/2 answers moved to approved/)).toBeVisible({ timeout: 15_000 });
    await expect(owner.getByRole("cell", { name: "Approved", exact: true })).toHaveCount(2);

    // 5. REVIEW QUEUE: nothing is awaiting review anymore (both approved).
    await owner.goto(`/app/${orgSlug}/review`);
    await expect(owner.getByRole("heading", { name: "Review queue" })).toBeVisible();
    await expect(owner.getByText("No answers are waiting for review right now.")).toBeVisible();
    const queueResults = await new AxeBuilder({ page: owner }).analyze();
    expect(queueResults.violations, `queue: ${JSON.stringify(queueResults.violations, null, 2)}`).toEqual([]);

    // 6. QUESTIONNAIRE LIFECYCLE: start review → complete (enabled now that
    // every question is resolved).
    await owner.goto(`/app/${orgSlug}/questionnaires`);
    await owner.getByRole("link", { name: "Flagship export questionnaire" }).click();
    await expect(owner.getByRole("button", { name: "Start review" })).toBeVisible({ timeout: 15_000 });
    await owner.getByRole("button", { name: "Start review" }).click();
    await expect(owner.getByRole("button", { name: "Complete review" })).toBeEnabled({ timeout: 15_000 });
    await owner.getByRole("button", { name: "Complete review" }).click();
    await expect(owner.getByText("completed").first()).toBeVisible({ timeout: 15_000 });

    // 7. EXPORT: the control unlocks; running it produces a real download
    // with the safe dated filename, then the history row with its checksum.
    await expect(owner.getByRole("button", { name: "Export answers" })).toBeEnabled({ timeout: 15_000 });
    const downloadPromise = owner.waitForEvent("download");
    await owner.getByRole("button", { name: "Export answers" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^flagship-questions-answers-\d{8}\.csv$/);

    // The history table appears with the checksum and a working download link.
    await expect(owner.getByText("Checksum (SHA-256)")).toBeVisible({ timeout: 15_000 });
    await expect(owner.getByRole("cell", { name: /2 questions · 2 approved/ }).first()).toBeVisible();

    // The questionnaire froze as exported; a re-export is still available.
    await expect(owner.getByText("Exported").first()).toBeVisible({ timeout: 15_000 });
    await expect(owner.getByRole("button", { name: "Export again" })).toBeVisible();
    await expect(owner.getByText(/answers frozen|frozen/i).first()).toBeVisible();

    const detailResults = await new AxeBuilder({ page: owner }).analyze();
    expect(detailResults.violations, `detail: ${JSON.stringify(detailResults.violations, null, 2)}`).toEqual([]);

    // 8. Download the HISTORICAL export through the short-lived signed URL.
    const historyDownload = owner.waitForEvent("download");
    await owner.getByRole("link", { name: /Download flagship-questions-answers/ }).first().click();
    const historical = await historyDownload;
    expect(historical.suggestedFilename()).toMatch(/^flagship-questions-answers-\d{8}\.csv$/);

    // 9. Notifications surface (plan §W6): axe-clean feed for this owner
    // (the actor-exclusion rule means an all-self workflow leaves it empty).
    await owner.goto(`/app/${orgSlug}/notifications`);
    await expect(owner.getByRole("heading", { name: "Notifications" })).toBeVisible({ timeout: 15_000 });
    const notificationResults = await new AxeBuilder({ page: owner }).analyze();
    expect(notificationResults.violations, `notifications: ${JSON.stringify(notificationResults.violations, null, 2)}`).toEqual([]);

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
