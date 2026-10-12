import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/session";

/**
 * Workspace memberships for the signed-in user — the data behind the org
 * switcher. Filtered to the caller's own rows; RLS scopes them further.
 */

export type Membership = {
  organizationId: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "reviewer" | "viewer";
};

export async function listMemberships(): Promise<Membership[]> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organizations(id, name, slug)")
    .eq("user_id", user.userId)
    .order("joined_at", { ascending: true });

  if (error !== null || data === null) {
    return [];
  }

  const memberships: Membership[] = [];
  for (const row of data) {
    const org = row.organizations;
    if (org !== null && org.slug !== "" && org.name !== "") {
      memberships.push({ organizationId: org.id, name: org.name, slug: org.slug, role: row.role });
    }
  }
  return memberships;
}
