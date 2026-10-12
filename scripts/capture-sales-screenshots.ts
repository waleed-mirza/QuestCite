import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

const baseUrl = process.env.SALES_CAPTURE_BASE_URL ?? "http://localhost:3100";
const outputDirectory = path.resolve("assets/sales/screenshots");

async function main(): Promise<void> {
  mkdirSync(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const demoPage = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    await demoPage.goto(`${baseUrl}/demo`, { waitUntil: "networkidle" });
    await demoPage.screenshot({ path: path.join(outputDirectory, "northstar-demo-overview.png"), fullPage: true });
    await demoPage.getByRole("button", { name: "Questionnaire" }).click();
    await demoPage.screenshot({ path: path.join(outputDirectory, "northstar-demo-questionnaire.png"), fullPage: true });

    const trustPage = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    await trustPage.goto(`${baseUrl}/trust/northstar-cloud`, { waitUntil: "networkidle" });
    await trustPage.screenshot({ path: path.join(outputDirectory, "northstar-trust-center.png"), fullPage: true });
    console.log("Sales screenshots captured: demo overview, questionnaire, and Trust Center.");
  } finally {
    await browser.close();
  }
}

void main().catch(() => {
  console.error("Sales screenshot capture failed.");
  process.exitCode = 1;
});
