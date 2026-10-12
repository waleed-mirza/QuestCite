/**
 * Shared env loading for the hosted-database integration suite.
 *
 * Loads env exactly like the Next runtime via @next/env. Extracted from
 * clients.ts so budget-gated live tests that never touch the database (e.g.
 * embeddings-live) see the same `.env.local` values — without it, a key that
 * exists only in the file never reaches process.env and a deliberate live run
 * silently skips instead of running (false pass, Session 12 fix).
 */

import { loadEnvConfig } from "@next/env";

import { assertProtectedOperationAllowed } from "@/lib/operations/production-guard";

let loaded = false;

export function loadIntegrationEnv(): void {
  if (loaded) return;
  const silent = { info: () => {}, error: () => {} };
  // Vitest sets NODE_ENV=test, and @next/env gives `.env.test` HIGHER
  // precedence than `.env.local` — which would shadow the real hosted-project
  // values with the deliberate fakes from Week 1 (the scanner's fixtures).
  // Load under a NODE_ENV that has no matching .env file so `.env.local`
  // wins; pre-set process.env (CI secrets) still take priority over files.
  const envHolder = process.env as { NODE_ENV?: string };
  const previousNodeEnv = envHolder.NODE_ENV;
  envHolder.NODE_ENV = "integration";
  try {
    loadEnvConfig(process.cwd(), false, silent);
  } finally {
    if (previousNodeEnv === undefined) {
      delete envHolder.NODE_ENV;
    } else {
      envHolder.NODE_ENV = previousNodeEnv;
    }
  }
  assertProtectedOperationAllowed("hosted-tests");
  loaded = true;
}
