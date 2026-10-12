import "server-only";

import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AppRole } from "@/server/authorization/org";

/**
 * Member/invite data access for the members surface. Everything reads through
 * the caller's own Supabase client, so RLS scopes every row; the helpers here
 * only shape queries and never elevate privileges (plan §7).
 */

export type MemberRow = {
  userId: string;
  fullName: string;
  email: string;
  role: AppRole;
  joinedAt: string;
};

export async function listMembers(): Promise<MemberRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data: members, error } = await supabase
    .from("organization_members")
    .select("user_id, role, joined_at")
    .order("joined_at", { ascending: true });

  if (error !== null || members === null) {
    return [];
  }

  const userIds = members.map((member) => member.user_id);
  if (userIds.length === 0) {
    return [];
  }

  // Profiles are linked by id equality (auth.users.id), not FK — fetch with an
  // in() filter. RLS allows exactly the org peers.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", userIds);
  const profileById = new Map<string, { full_name: string; email: string }>();
  for (const profile of profiles ?? []) {
    profileById.set(profile.id, { full_name: profile.full_name, email: profile.email });
  }

  return members.map((member) => {
    const profile = profileById.get(member.user_id);
    return {
      userId: member.user_id,
      fullName: profile?.full_name ?? "",
      email: profile?.email ?? "",
      role: member.role,
      joinedAt: member.joined_at,
    };
  });
}

export type PendingInviteRow = {
  id: string;
  email: string;
  role: AppRole;
  createdAt: string;
  expiresAt: string;
  /** Computed at fetch time so components stay free of impure Date calls. */
  expired: boolean;
};

export async function listPendingInvites(): Promise<PendingInviteRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organization_invites")
    .select("id, email, role, created_at, expires_at")
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error !== null || data === null) {
    return [];
  }
  const now = Date.now();
  return data.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    createdAt: invite.created_at,
    expiresAt: invite.expires_at,
    expired: new Date(invite.expires_at).getTime() < now,
  }));
}

/** The raw token is returned once to show a one-time link; only the hash lands in the DB. */
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  return { token, tokenHash };
}
