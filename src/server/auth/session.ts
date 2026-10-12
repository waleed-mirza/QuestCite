import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UnauthorizedError } from "@/server/errors";

/**
 * Verified session access (plan §7: `getClaims()` — never trust an unverified
 * `getSession()` object as authorization proof).
 */

export type UserIdentity = {
  userId: string;
  email: string;
};

/**
 * Returns the verified identity, or null when there is no valid session.
 *
 * A missing Supabase configuration (fresh clone, CI without secrets) also
 * yields null: no session can exist there, so "anonymous" is the correct
 * fail-closed posture for every caller. Production builds gate on check-env,
 * so that branch is unreachable in a real deployment. This keeps public pages
 * renderable without auth infrastructure — restoring the Week 1 gate promise
 * that a fresh clone can build.
 */
export async function getUser(): Promise<UserIdentity | null> {
  let claims: unknown = null;
  let error: { message: string } | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const result = await supabase.auth.getClaims();
    claims = result.data?.claims ?? null;
    error = result.error;
  } catch {
    // Unconfigured (or unreachable) auth client — treat as anonymous.
    return null;
  }

  if (error !== null || claims === null || typeof claims !== "object" || claims === null) {
    return null;
  }
  const sub = (claims as { sub?: unknown }).sub;
  const email = (claims as { email?: unknown }).email;
  if (typeof sub !== "string" || sub === "") {
    return null;
  }

  return { userId: sub, email: typeof email === "string" ? email : "" };
}

/** Verified identity or UnauthorizedError — callers map it to their context. */
export async function requireUser(): Promise<UserIdentity> {
  const user = await getUser();
  if (user === null) {
    throw new UnauthorizedError();
  }
  return user;
}
