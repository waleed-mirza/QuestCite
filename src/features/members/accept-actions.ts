"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/observability/logger";
import { getUser } from "@/server/auth/session";

/**
 * Invitation acceptance (journey J2 step 4–5): the atomic RPC verifies token,
 * email match, expiry, revocation, and organization status, then creates the
 * membership and marks the invite accepted in one transaction.
 */
export async function acceptInviteAction(token: string): Promise<void> {
  const user = await getUser();
  if (user === null) {
    redirect(`/login?redirectTo=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const supabase = await createSupabaseServerClient();
  const { data: orgId, error } = await supabase.rpc("accept_organization_invite", {
    p_raw_token: token,
  });

  if (error !== null || typeof orgId !== "string" || orgId === "") {
    // Same generic outcome for every rejection — the page renders the neutral
    // "invitation invalid" card.
    redirect(`/invite/${encodeURIComponent(token)}?error=1`);
  }

  // Now a member: the slug lookup is readable under RLS. Fall back to the
  // workspace router if anything unexpected happens.
  const { data: org } = await supabase.from("organizations").select("slug").eq("id", orgId).maybeSingle();
  const slug = typeof org?.slug === "string" && org.slug !== "" ? org.slug : null;
  if (slug === null) {
    logger.warn("accepted invite but slug lookup failed");
    redirect("/onboarding");
  }
  redirect(`/app/${slug}`);
}
