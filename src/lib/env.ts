import "server-only";

import { collectEnvWarnings, envSchema, type Env } from "@/lib/validation/env-schema";

/**
 * Server-side environment accessor. Import this anywhere server code needs
 * validated configuration. Client Components must use @/config/app instead —
 * the `server-only` guard makes any accidental client import a build error.
 *
 * Errors deliberately mention variable NAMES only, never values (plan §14).
 */

let cached: Env | undefined;

export function getServerEnv(): Env {
  if (cached !== undefined) {
    return cached;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        return path === "" ? "environment" : path;
      })
      .join(", ");
    throw new Error(`Invalid environment configuration (variable names only): ${names}. Run \`pnpm check-env\` for the full report.`);
  }

  cached = parsed.data;
  return cached;
}

/** Test-only: clears the memoized parse so tests can vary process.env. */
export function resetServerEnvCache(): void {
  cached = undefined;
}

export { collectEnvWarnings };
