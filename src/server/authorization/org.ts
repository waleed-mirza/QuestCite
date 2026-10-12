import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { requireUser } from "@/server/auth/session";

/**
 * Tenant authorization helpers (plan §7). Membership always resolves through
 * RLS-backed queries with the user's own client, so the database remains the
 * final enforcement layer even if a bug ever bypasses these checks.
 */

export type AppRole = Database["public"]["Enums"]["app_role"];

export const ALL_ROLES: readonly AppRole[] = ["owner", "admin", "reviewer", "viewer"];

export type OrgContext = {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  role: AppRole;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  status: Database["public"]["Enums"]["organization_status"];
};

/**
 * Resolves the caller's membership in the organization identified by `slug`.
 *
 * - Not signed in → UnauthorizedError
 * - Org missing, deactivated, or invisible (RLS filters non-members) → NotFoundError
 * - Member but role not in `allowedRoles` → ForbiddenError
 */
export async function requireOrgRole(allowedRoles: readonly AppRole[], slug: string): Promise<OrgContext> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, name, slug, status")
    .eq("slug", slug)
    .maybeSingle();

  // Fail closed: any lookup error is treated as "not visible".
  if (orgError !== null) {
    throw new NotFoundError("organization");
  }
  // A null result covers both "no such org" and "not a member" — neither is
  // distinguished to the caller, so existence never leaks across tenants.
  if (org === null || org.status !== "active") {
    throw new NotFoundError("organization");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", org.id)
    .eq("user_id", user.userId)
    .maybeSingle();

  if (membershipError !== null || membership === null) {
    throw new NotFoundError("organization");
  }
  if (!allowedRoles.includes(membership.role)) {
    throw new ForbiddenError();
  }

  const organization: OrganizationRow = org;
  return {
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    role: membership.role,
  };
}

/** Any membership in the org. */
export async function requireOrg(slug: string): Promise<OrgContext> {
  return requireOrgRole(ALL_ROLES, slug);
}
