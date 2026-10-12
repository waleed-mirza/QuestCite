import { expect, test } from "@playwright/test";

/**
 * Week 10 visual gate. These pages are deliberately signed-out and fixture-
 * backed so a screenshot comparison never needs a real account, document,
 * answer, prompt, token, or provider response.
 */
type VisualView = {
  name: string;
  path: string;
  interaction?: "questionnaire";
};

const VIEWS: readonly VisualView[] = [
  { name: "landing", path: "/" },
  { name: "demo-dashboard", path: "/demo" },
  { name: "demo-questionnaire", path: "/demo", interaction: "questionnaire" },
  { name: "trust-center", path: "/trust/northstar-cloud" },
] as const;

for (const view of VIEWS) {
  test(`matches the ${view.name} release baseline`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(view.path, { waitUntil: "networkidle" });

    if (view.interaction === "questionnaire") {
      await page.getByRole("button", { name: "Questionnaire", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Security Assessment" })).toBeVisible();
    }

    await expect(page).toHaveScreenshot(`${view.name}-${testInfo.project.name}.png`, {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
}
