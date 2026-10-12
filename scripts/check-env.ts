/**
 * Environment validator (plan §14).
 *
 * Loads .env files exactly the way Next.js does (@next/env), validates them
 * against the Zod schema, and prints a report of variable NAMES ONLY — values
 * are never printed. Exits non-zero on any error so `pnpm build` fails fast on
 * dangerous production configuration.
 *
 * Usage: pnpm check-env   (also runs as part of `pnpm build`)
 */

import { loadEnvConfig } from "@next/env";

import { collectEnvWarnings, envSchema } from "../src/lib/validation/env-schema";

function main(): number {
  // `@next/env` resolves .env.local / .env.development / .env.production /
  // .env.test in the same order and precedence the Next runtime uses.
  const silent = { info: () => {}, error: () => {} };
  loadEnvConfig(process.cwd(), false, silent);

  const parsed = envSchema.safeParse(process.env);
  const warnings = parsed.success ? collectEnvWarnings(parsed.data) : [];

  const totalVars = Object.keys(envSchema.shape).length;

  if (!parsed.success) {
    console.error("\n✖ Environment validation FAILED\n");
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".") || "(root)";
      // Names and reasons only — issue messages never embed values by construction.
      console.error(`  ✖ ${path}: ${issue.message}`);
    }
    console.error(`\n${parsed.error.issues.length} error(s) across ${totalVars} known variables.`);
    console.error("Fix the listed variables in .env.local (never commit real values). Names only shown above.\n");
    return 1;
  }

  console.log(`\n✓ Environment valid (${totalVars} known variables, mode: ${parsed.data.APP_ENV})`);

  if (warnings.length > 0) {
    console.warn("\nWarnings:");
    for (const warning of warnings) {
      console.warn(`  ⚠ ${warning}`);
    }
  }
  console.log("");
  return 0;
}

process.exitCode = main();
