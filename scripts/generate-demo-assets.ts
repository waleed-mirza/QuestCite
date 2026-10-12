import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createDemoWorkbook } from "./demo-workbook";

const outputDirectory = path.resolve("public/demo");
const outputPath = path.join(outputDirectory, "northstar-cloud-security-assessment.xlsx");

async function main(): Promise<void> {
  mkdirSync(outputDirectory, { recursive: true });
  const workbook = await createDemoWorkbook("completed");
  writeFileSync(outputPath, workbook);
  console.log(`Generated demo workbook (${workbook.byteLength} bytes).`);
}

void main().catch(() => {
  console.error("Demo asset generation failed.");
  process.exitCode = 1;
});
