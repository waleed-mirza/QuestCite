import "server-only";

import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * In-app notifications read model (plan §8/§W6). Rows are written by the
 * 0018 triggers (status flips, comments, assignments, exports); this module
 * only reads the caller's own rows (RLS enforces that) and resolves the
 * display strings. Metadata carries ids only — never question/answer text.
 */

export type NotificationRow = {
  id: string;
  type: string;
  entityType: string;
  entityId: string | null;
  questionnaireId: string | null;
  questionnaireTitle: string | null;
  readAt: string | null;
  createdAt: string;
};

export async function listMyNotifications(
  organizationId: string,
  userId: string,
): Promise<NotificationRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, entity_type, entity_id, questionnaire_id, read_at, created_at, questionnaires(title)")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error !== null || data === null) {
    logger.warn("notifications query failed", { code: "QUERY_FAILED" });
    return [];
  }

  return data.map((row) => {
    // supabase-js types nested selects loosely — one narrowing read.
    const record = row as typeof row & { questionnaires: { title: string } | null };
    return {
      id: row.id,
      type: row.type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      questionnaireId: row.questionnaire_id,
      questionnaireTitle: record.questionnaires?.title ?? null,
      readAt: row.read_at,
      createdAt: row.created_at,
    };
  });
}

export async function countMyUnread(organizationId: string, userId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .is("read_at", null);
  if (error !== null) {
    logger.warn("unread count query failed", { code: "QUERY_FAILED" });
    return 0;
  }
  return count ?? 0;
}
