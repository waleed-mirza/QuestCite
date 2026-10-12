"use server";

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/server/authorization/org";

/**
 * Notification read-state actions (plan §W6). RLS (migration 0020) scopes
 * every update to the caller's own rows — marking someone else's notification
 * read is silently a no-op at the database.
 */

export async function markNotificationReadAction(orgSlug: string, formData: FormData): Promise<void> {
  const ctx = await requireOrgRole(["owner", "admin", "reviewer", "viewer"], orgSlug);
  const notificationId = formData.get("notificationId");
  if (typeof notificationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notificationId)) {
    return;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("organization_id", ctx.organization.id)
    .is("read_at", null);
  if (error !== null) {
    logger.warn("notification read update failed", { code: "QUERY_FAILED" });
  }

  revalidatePath(`/app/${orgSlug}/notifications`);
}

export async function markAllNotificationsReadAction(orgSlug: string): Promise<void> {
  const ctx = await requireOrgRole(["owner", "admin", "reviewer", "viewer"], orgSlug);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("organization_id", ctx.organization.id)
    .is("read_at", null);
  if (error !== null) {
    logger.warn("mark-all-read failed", { code: "QUERY_FAILED" });
  }

  revalidatePath(`/app/${orgSlug}/notifications`);
}
