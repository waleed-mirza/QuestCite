import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Automated a11y smoke (axe) over the public shells. Authenticated surfaces
 * get their own axe passes in the W2 E2E suite, which signs in first.
 * Keyboard-only and screen-reader checks remain manual per the quality
 * protocol — this catches the regression-prone baseline: landmarks, names,
 * contrast, heading order.
 */

const SHELLS = [
  { name: "landing", path: "/" },
  { name: "login", path: "/login" },
  { name: "signup", path: "/signup" },
  { name: "forgot-password", path: "/forgot-password" },
  { name: "demo", path: "/demo" },
  { name: "pricing", path: "/pricing" },
  { name: "faq", path: "/faq" },
  { name: "docs", path: "/docs" },
  { name: "privacy", path: "/privacy" },
  { name: "terms", path: "/terms" },
] as const;

for (const shell of SHELLS) {
  test(`${shell.name} shell has no automatically-detectable axe violations`, async ({ page }) => {
    await page.goto(shell.path);
    // Next streams some shell content after the initial document response;
    // wait for the page's primary heading before taking the accessibility
    // snapshot so a transient early stream close cannot produce a partial DOM.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}
