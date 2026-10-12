/**
 * Secret scanner (CI gate): scans every git-tracked text file for
 * real-looking credentials, and asserts committed env fixtures (.env.example,
 * .env.test) only ever contain explicitly-fake values. Prints file/line/
 * pattern names — never matched values. Exits 1 on any finding.
 *
 * Usage: pnpm scan:secrets
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  assertFixtureValuesAreFake,
  scanContent,
  type SecretFinding,
} from "../src/lib/security/secret-scanner";

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".css", ".html", ".yml", ".yaml",
  ".toml", ".sql", ".env", ".sh", ".txt", ".example", ".test",
]);

const ENV_FIXTURES = [".env.example", ".env.test"] as const;

/**
 * The scanner's own unit tests must contain realistic-shaped inert keys to
 * prove detection works — the one canonical exemption, explicit and audited.
 */
const SCANNER_FIXTURE_FILES = new Set(["tests/unit/secret-scanner.test.ts"]);

function trackedFiles(): string[] {
  const output = execFileSync("git", ["ls-files"], { encoding: "utf-8" });
  return output.split(/\r?\n/).filter(Boolean);
}

function isScannable(file: string): boolean {
  if (file.startsWith("pnpm-lock.yaml")) return false; // dependency hashes, not secrets
  const dot = file.lastIndexOf(".");
  const ext = dot === -1 ? "" : file.slice(dot);
  return TEXT_EXTENSIONS.has(ext) || file.includes(".env");
}

function main(): number {
  const files = trackedFiles();
  const findings: SecretFinding[] = [];

  for (const file of files) {
    if (!isScannable(file) || SCANNER_FIXTURE_FILES.has(file)) {
      continue;
    }
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue; // binary or unreadable — skip
    }
    findings.push(...scanContent(file, content));

    const base = file.split("/").pop() ?? file;
    if ((ENV_FIXTURES as readonly string[]).includes(base)) {
      findings.push(...assertFixtureValuesAreFake(content).map((f) => ({ ...f, file })));
    }
  }

  if (findings.length > 0) {
    console.error("\n✖ Secret scan FAILED — findings (names only, values never shown):\n");
    for (const finding of findings) {
      console.error(`  ✖ ${finding.file}:${finding.line} — ${finding.pattern}`);
    }
    console.error(`\n${findings.length} finding(s). Fix before committing.\n`);
    return 1;
  }

  console.log(`✓ Secret scan clean (${files.length} tracked files; fixtures verified fake)`);
  return 0;
}

process.exitCode = main();
