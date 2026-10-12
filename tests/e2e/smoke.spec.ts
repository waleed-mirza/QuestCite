import { expect, test } from "@playwright/test";

import { projectConfig } from "@/config/project";

test.describe("Week 2 public-surface smoke", () => {
  test("landing page renders hero and navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Answer security questionnaires in hours, not weeks",
    );
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });

  test("login page renders the sign-in form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Work email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  test("signup page renders the registration form", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await expect(page.getByLabel("Full name")).toBeVisible();
    await expect(page.getByLabel("Confirm password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  test("anonymous visitors are redirected from workspace surfaces to login", async ({ page }) => {
    await page.goto("/app/some-workspace");
    await expect(page).toHaveURL(/\/login\?redirectTo=/);
  });

  test("header and hero link to the public source repository", async ({ page }) => {
    await page.goto("/");
    const headerSource = page.getByRole("link", { name: "Source", exact: true });
    const heroSource = page.getByRole("link", { name: "View on GitHub" });
    await expect(headerSource).toHaveAttribute("href", projectConfig.repositoryUrl);
    await expect(heroSource).toHaveAttribute("href", projectConfig.repositoryUrl);
  });

  test("explains the MIT license and self-hosted handoff", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByText("MIT-licensed source. You install and host it.", { exact: true }),
    ).toBeVisible();

    await expect(page.getByRole("heading", { name: "Free under the MIT License" })).toBeVisible();
    await expect(page.getByRole("link", { name: "View source on GitHub" })).toHaveAttribute(
      "href",
      projectConfig.repositoryUrl,
    );
    await expect(page.getByRole("link", { name: "Self-host details" })).toHaveAttribute("href", "/pricing");

    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: "What you operate" })).toBeVisible();
    await expect(page.getByText(/Lemon Squeezy workspace billing are optional/)).toBeVisible();
  });

  test("marketing information routes render their primary headings", async ({ page }) => {
    const routes = [
      ["/pricing", "QuestCite is open source"],
      ["/faq", "Honest answers before you deploy"],
      ["/docs", "Understand the boundary before you deploy"],
      ["/privacy", "Privacy notice"],
      ["/terms", "Terms and license"],
    ] as const;

    for (const [path, heading] of routes) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
  });

  test("pricing page links to the MIT source repository", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("link", { name: "View source on GitHub" })).toHaveAttribute(
      "href",
      projectConfig.repositoryUrl,
    );
  });

  test("legal and support surfaces identify the maintainer", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByText("WHH Treasures", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "whhtreasures@gmail.com" })).toHaveAttribute(
      "href",
      "mailto:whhtreasures@gmail.com",
    );

    await page.goto("/terms");
    await expect(page.getByText("WHH Treasures", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Support" })).toHaveAttribute(
      "href",
      "mailto:whhtreasures@gmail.com",
    );
  });

  test("public SEO endpoints exclude authenticated surfaces", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.ok()).toBe(true);
    const robotsText = await robots.text();
    expect(robotsText).toContain("Disallow: /app/");
    expect(robotsText).toContain("Sitemap:");

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.ok()).toBe(true);
    const sitemapText = await sitemap.text();
    expect(sitemapText).toContain("/pricing");
    expect(sitemapText).not.toContain("/app/");
  });
});
