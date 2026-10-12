import { expect, test } from "@playwright/test";

/**
 * Week 10 signed-out hardening matrix. These checks deliberately use the
 * provider-free demo and public auth boundary so Chrome, Edge, Firefox, and
 * the mobile viewport can run without an account, token, or paid provider.
 */
test.describe("Week 10 browser hardening matrix", () => {
  test("loads the demo and replays without provider traffic", async ({ page }) => {
    const providerRequests: string[] = [];
    page.on("request", (request) => {
      if (/openai|resend|lemonsqueezy/i.test(request.url())) {
        providerRequests.push(request.url());
      }
    });

    await page.goto("/demo", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Northstar Cloud" })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("SAMPLE DATA");
    await page.getByRole("button", { name: "Replay run" }).click();
    await expect(page.getByRole("heading", { name: "Security Assessment" })).toBeVisible();
    await expect(page.getByText("Replay complete", { exact: false })).toBeVisible({ timeout: 5_000 });
    expect(providerRequests).toEqual([]);
  });

  test("keeps the workspace boundary fail-closed for an expired session", async ({ page }) => {
    await page.goto("/app/w10-expired-session");
    await expect(page).toHaveURL(/\/login\?redirectTo=/);
    expect(new URL(page.url()).searchParams.get("redirectTo")).toBe("/app/w10-expired-session");
  });

  test("renders the signed-out shell after a delayed document response", async ({ page }) => {
    await page.route("**/demo", async (route) => {
      await delay(300);
      await route.continue();
    });

    await page.goto("/demo", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Northstar Cloud" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "From evidence to defensible answers" })).toBeVisible();
  });

  test("keeps local demo interactions usable after the network drops", async ({ context, page }) => {
    await page.goto("/demo", { waitUntil: "networkidle" });
    await context.setOffline(true);
    await page.getByRole("button", { name: "Questionnaire", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Security Assessment" })).toBeVisible();
    await context.setOffline(false);
  });
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
