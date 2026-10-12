/**
 * Release audit (CI gate + release rehearsal): verifies the file set that
 * WOULD ship in a release ZIP. The audit proves the packaging transform
 * (`filterReleaseFiles`) drops private notes and sales copy, that no stray
 * .env file would ship, and that env fixtures only contain fake secrets.
 *
 * Usage: pnpm audit:release
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  auditReleaseInventory,
  filterReleaseFiles,
} from "../src/lib/security/release-inventory";
import {
  assertFixtureValuesAreFake,
  scanContent,
} from "../src/lib/security/secret-scanner";

function trackedFiles(): string[] {
  const output = execFileSync("git", ["ls-files"], { encoding: "utf-8" });
  return output.split(/\r?\n/).filter(Boolean);
}

function main(): number {
  const tracked = trackedFiles();
  const releaseFiles = filterReleaseFiles(tracked);
  const excludedCount = tracked.length - releaseFiles.length;
  let failed = false;

  const violations = auditReleaseInventory(releaseFiles);
  if (violations.length > 0) {
    failed = true;
    console.error("\n✖ Release inventory FAILED — the packaging transform leaks:\n");
    for (const violation of violations) {
      console.error(`  ✖ [${violation.kind}] ${violation.path} — ${violation.reason}`);
    }
  }

  // Env fixtures must be fake wherever they appear in the release set.
  for (const file of releaseFiles) {
    const base = file.split("/").pop() ?? file;
    if (base === ".env.example" || base === ".env.test") {
      const content = readFileSync(file, "utf-8");
      const fixtureFindings = [
        ...scanContent(file, content),
        ...assertFixtureValuesAreFake(content).map((f) => ({ ...f, file })),
      ];
      if (fixtureFindings.length > 0) {
        failed = true;
        console.error(`\n✖ Fixture ${file} contains non-fake secret values:`);
        for (const finding of fixtureFindings) {
          console.error(`  ✖ line ${finding.line} — ${finding.pattern}`);
        }
      }
    }
  }

  if (failed) {
    console.error("\nRelease audit FAILED.\n");
    return 1;
  }

  console.log(
    `✓ Release audit clean — ${releaseFiles.length} files would ship; ` +
      `${excludedCount} private file(s) excluded by packaging; fixtures verified fake`,
  );
  return 0;
}

process.exitCode = main();
