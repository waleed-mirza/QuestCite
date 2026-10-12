import "server-only";

import type { Database } from "@/types/database.types";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Reviewer queue (plan §W6): the questions that need a human decision,
 * surfaced across questionnaires. Two views:
 *
 * - MINE — questions assigned to the caller in an actionable review state
 *   (in review / changes requested / rejected). These owe the assignee work.
 * - AWAITING — everything currently sitting in_review across the org, so a
 *   reviewer (or admin) sees the whole pending pile even when questions are
 *   assigned elsewhere. Viewers get an empty list — the permission matrix
 *   keeps them out of review work, and every RPC re-checks it anyway.
 *
 * RLS scopes every query to the caller's organizations; this module only
 * shapes the read.
 */

type AnswerStatus = Database["public"]["Enums"]["answer_status"];

export type ReviewQueueItem = {
  questionId: string;
  questionnaireId: string;
  questionnaireTitle: string;
  questionText: string;
  category: string;
  status: AnswerStatus;
};

const QUEUE_CAP = 50;

const ACTIONABLE: AnswerStatus[] = ["in_review", "changes_requested", "rejected"];

type QueueRow = {
  id: string;
  question_original: string;
  category: string;
  status: AnswerStatus;
  questionnaire_id: string;
  questionnaires: { title: string } | null;
};

async function fetchQueue(
  organizationId: string,
  where: { assigneeId?: string; statuses: AnswerStatus[] },
): Promise<ReviewQueueItem[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("questions")
    .select("id, question_original, category, status, questionnaire_id, questionnaires(title)")
    .eq("organization_id", organizationId)
    .in("status", where.statuses)
    .order("updated_at", { ascending: false })
    .limit(QUEUE_CAP);
  if (where.assigneeId !== undefined) {
    query = query.eq("assignee_id", where.assigneeId);
  }

  const { data, error } = await query;
  if (error !== null || data === null) {
    logger.warn("review queue query failed", { code: "QUERY_FAILED" });
    return [];
  }
  return (data as QueueRow[]).map((row) => ({
    questionId: row.id,
    questionnaireId: row.questionnaire_id,
    questionnaireTitle: row.questionnaires?.title ?? "Questionnaire",
    questionText: row.question_original,
    category: row.category,
    status: row.status,
  }));
}

export async function listMyReviewQueue(organizationId: string, userId: string): Promise<ReviewQueueItem[]> {
  return fetchQueue(organizationId, { assigneeId: userId, statuses: ACTIONABLE });
}

export async function listAwaitingReview(organizationId: string): Promise<ReviewQueueItem[]> {
  return fetchQueue(organizationId, { statuses: ["in_review"] });
}
