/**
 * Admin-API fixtures for the authenticated E2E journey (D016 — hosted
 * project, no Docker).
 *
 * The service-role key is used in THIS file only — Playwright test code runs
 * in Node, never in the browser bundle, which keeps the Week 2 gate intact
 * ("no service-role key in browser bundles"). Verification links are minted
 * with generateLink so the rate-limited built-in email is never involved.
 */

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

let loaded = false;

function ensureEnv(): void {
  if (loaded) return;
  // Playwright does not load .env.local itself; mirror the Next.js order.
  loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });
  loaded = true;
}

export function hasAuthFixtureEnv(): boolean {
  ensureEnv();
  const explicitJourney = process.env.E2E_AUTH_JOURNEY === "1";
  // CI is never allowed to infer consent from the generic CI flag. The
  // repository variable/secret pair makes a production-project mutation an
  // intentional operator decision; local runs opt in with E2E_AUTH_JOURNEY=1.
  const isCi = process.env.CI !== undefined && process.env.CI !== "";
  const hostedConsent = !isCi || process.env.ALLOW_HOSTED_TEST_MUTATIONS === "true";
  return (
    explicitJourney &&
    hostedConsent &&
    process.env.NEXT_PUBLIC_SUPABASE_URL !== undefined &&
    process.env.NEXT_PUBLIC_SUPABASE_URL !== "" &&
    process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined &&
    process.env.SUPABASE_SERVICE_ROLE_KEY !== ""
  );
}

/**
 * The first fetch of a Node process intermittently dies on Windows with a
 * bare "fetch failed" (documented W2 toolchain quirk). Network-level
 * TypeErrors get exactly one retry; HTTP-level outcomes pass through.
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

export function adminClient(): SupabaseClient<Database> {
  ensureEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || url === "" || key === undefined || key === "") {
    throw new Error("auth-fixtures require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: retryingFetch },
  });
}

const E2E_PASSWORD = "E2E-Journey-2026!x";

const userIds: string[] = [];

export function e2eEmail(localPart: string): string {
  return `e2e-${localPart}-${Date.now().toString(36)}@journey.invalid`;
}

/** Creates a confirmed user (an existing teammate) who can sign in immediately. */
export async function createConfirmedUser(email: string): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: E2E_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: localPartOf(email) },
  });
  if (error !== null || data.user === null) {
    throw new Error(`createUser failed: ${error?.message ?? "no user"}`);
  }
  userIds.push(data.user.id);
  return data.user.id;
}

/**
 * Mints a sign-in link through the REAL PKCE callback path (D020). The
 * built-in email service is rate-limited hard enough that `signUp` itself
 * 429s, so the journey provisions confirmed users via the admin API and
 * enters through a magiclink-style generateLink — same /auth/callback code
 * exchange a clicked verification link performs, with zero emails sent.
 */
export async function generateVerificationLink(email: string, redirectTo: string): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  if (error !== null || data.properties?.action_link === undefined) {
    throw new Error(`generateLink failed: ${error?.message ?? "no action link"}`);
  }
  return data.properties.action_link;
}

export async function cleanupUsers(): Promise<void> {
  const admin = adminClient();
  for (const userId of userIds.splice(0)) {
    await admin.auth.admin.deleteUser(userId);
  }
}

function localPartOf(email: string): string {
  return email.split("@")[0] ?? "e2e-user";
}

export { E2E_PASSWORD };
