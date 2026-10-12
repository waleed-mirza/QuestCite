import "server-only";

import { isForbiddenError, isNotFoundError, isUnauthorizedError } from "@/server/errors";
import { ALL_ROLES, requireOrgRole, type AppRole, type OrgContext } from "@/server/authorization/org";

/**
 * Maps authorization outcomes to a discriminated result so pages can render
 * the right state (rule 11): sign-in, not-found, or access-denied — without
 * leaking which one applies across tenants (not-found and forbidden are
 * distinguished only for the caller's own membership statuses).
 */

export type GuardOutcome =
  | { ok: true; ctx: OrgContext }
  | { ok: false; reason: "unauthenticated" | "not-found" | "forbidden" };

export async function guardOrgRoles(slug: string, roles: readonly AppRole[]): Promise<GuardOutcome> {
  try {
    return { ok: true, ctx: await requireOrgRole(roles, slug) };
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return { ok: false, reason: "unauthenticated" };
    }
    if (isNotFoundError(error)) {
      return { ok: false, reason: "not-found" };
    }
    if (isForbiddenError(error)) {
      return { ok: false, reason: "forbidden" };
    }
    throw error;
  }
}

/** Any membership is enough. */
export async function guardOrg(slug: string): Promise<GuardOutcome> {
  return guardOrgRoles(slug, ALL_ROLES);
}
