/**
 * Client-safe copy for notification types (rule 8/plan §16): the display
 * sentence for each trigger-written type (migration 0018). Unknown future
 * types fall back to a generic line — never an error.
 */

export const NOTIFICATION_TYPE_COPY: Record<string, string> = {
  "question.assigned": "A question was assigned to you",
  "questionnaire.assigned": "You were assigned as reviewer for a questionnaire",
  "answer.in_review": "An answer was submitted for review",
  "answer.changes_requested": "Changes were requested on an answer",
  "answer.rejected": "An answer was rejected",
  "answer.approved": "An answer was approved",
  "comment.added": "New comment on a question you're involved in",
  "questionnaire.exported": "A questionnaire was exported",
  "trust_access.requested": "Someone requested access to gated documents",
};

export function notificationCopyFor(type: string): string {
  return NOTIFICATION_TYPE_COPY[type] ?? "Workspace update";
}
