/**
 * Client factory for the hosted-database integration suite (D016).
 *
 * Loads env exactly like the Next runtime via @next/env and fails fast with a
 * clear message when the Supabase variables are missing, so a misconfigured
 * run cannot silently test against nothing.
 *
 * The service-role (admin) client provisions fixtures server-side ONLY. It
 * must never be imported from browser code — that boundary is enforced by
 * `server-only` markers in src/lib/supabase, not here.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

import { loadIntegrationEnv } from "./load-env";

function requireEnv(name: string): string {
  loadIntegrationEnv();
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing ${name} — pnpm test:db runs against the linked hosted project (see docs/setup-supabase.md). Copy the keys into .env.local or export them in CI.`,
    );
  }
  // Tolerate CRLF/newline contamination from secret pipelines — values must
  // still be valid URLs/keys, they just survive accidental whitespace.
  return value.trim();
}

export function supabaseUrl(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function publishableKey(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export function serviceRoleKey(): string {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

/**
 * The first fetch of a Vitest fork intermittently dies on Windows with a bare
 * "fetch failed" (documented W2 toolchain quirk — same wrapper as the e2e
 * admin fixtures). Network-level TypeErrors get exactly one retry; HTTP-level
 * outcomes pass through untouched so RLS refusals are never masked.
 */
async function retryingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof TypeError) {
      return await fetch(input, init);
    }
    throw error;
  }
}

export const CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: retryingFetch },
} as const;

/** Unauthenticated client — exactly what a browser would hold. */
export function getAnonClient(): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl(), publishableKey(), CLIENT_OPTIONS);
}

/** Service-role client for fixture provisioning and cleanup. Server-side only. */
export function getAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl(), serviceRoleKey(), CLIENT_OPTIONS);
}
