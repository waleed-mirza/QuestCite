import { expect, test } from "@playwright/test";

test.describe("Week 9 public demo", () => {
  test("replays stored results and keeps provider mutations disabled", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      if (/openai|resend|lemonsqueezy/i.test(request.url())) {
        externalRequests.push(request.url());
      }
    });

    await page.goto("/demo");
    await expect(page.getByRole("heading", { name: "Northstar Cloud" })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("SAMPLE DATA");
    await expect(page.getByRole("heading", { name: "From evidence to defensible answers" })).toBeVisible();

    await page.getByRole("button", { name: "Replay run" }).click();
    await expect(page.getByRole("heading", { name: "Security Assessment" })).toBeVisible();
    await expect(page.getByText("Replay complete", { exact: false })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("AI is off for the public demo", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Review & export" }).click();
    await expect(page.getByRole("heading", { name: "Review & export" })).toBeVisible();
    await expect(page.getByText("8 decisions still needed", { exact: false })).toBeVisible();

    const disabledButtons = page.getByRole("button", { name: "Unavailable in demo" });
    await expect(disabledButtons).toHaveCount(4);
    for (let index = 0; index < await disabledButtons.count(); index += 1) {
      await expect(disabledButtons.nth(index)).toBeDisabled();
    }
    expect(externalRequests).toEqual([]);
  });

  test("downloads the completed fictional workbook", async ({ page }) => {
    await page.goto("/demo");
    await page.getByRole("button", { name: "Questionnaire" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download workbook" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("northstar-cloud-security-assessment.xlsx");
  });
});
