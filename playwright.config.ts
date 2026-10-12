import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E (tests/e2e) and accessibility (tests/accessibility) suites.
 * Runs against a production build for determinism: `pnpm test:e2e` builds
 * first (which also runs check-env), then boots `next start` on port 3100.
 */

const PORT = 3100;

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "e2e",
      testMatch: "tests/e2e/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "a11y",
      testMatch: "tests/accessibility/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "visual-desktop",
      testMatch: "tests/visual/**/*.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        colorScheme: "light",
      },
    },
    {
      name: "visual-mobile",
      testMatch: "tests/visual/**/*.spec.ts",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        colorScheme: "light",
      },
    },
    {
      name: "w10-chrome",
      testMatch: "tests/e2e/w10-browser-matrix.spec.ts",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
    {
      name: "w10-edge",
      testMatch: "tests/e2e/w10-browser-matrix.spec.ts",
      use: { ...devices["Desktop Chrome"], channel: "msedge" },
    },
    {
      name: "w10-firefox",
      testMatch: "tests/e2e/w10-browser-matrix.spec.ts",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "w10-mobile",
      testMatch: "tests/e2e/w10-browser-matrix.spec.ts",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Safe test-mode values let the authenticated billing journey exercise
      // signature verification without configuring a live payment provider.
      LEMON_SQUEEZY_TEST_MODE: "true",
      LEMON_SQUEEZY_STORE_ID: "42",
      LEMON_SQUEEZY_WEBHOOK_SECRET: "fake-webhook-secret-for-e2e",
      LEMON_SQUEEZY_STARTER_VARIANT_ID: "101",
      LEMON_SQUEEZY_PRO_VARIANT_ID: "102",
      LEMON_SQUEEZY_AGENCY_VARIANT_ID: "103",
    },
  },
});
