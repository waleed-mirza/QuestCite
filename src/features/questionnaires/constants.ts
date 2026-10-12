/**
 * Shared questionnaire feature constants — client-safe, no "use server"/
 * "use client" directives, importable from both server components and
 * client islands.
 */

/**
 * The bulk-operations toolbar form id. Row checkboxes join it remotely via
 * the `form` attribute — the question table itself must never sit inside a
 * form (expanded rows contain their own comment forms; nested forms are
 * invalid HTML and break React's form handling).
 */
export const BULK_FORM_ID = "questionnaire-bulk-form";

/**
 * Answer-status labels (PRD §7.2 lifecycle), client-safe: shared by the data
 * table badges and the progress dashboard. Identity comes from the text, not
 * from color.
 */
export const STATUS_LABELS: Record<string, string> = {
  empty: "Not answered",
  generating: "AI drafting",
  drafted: "AI drafted",
  answered: "Answered",
  insufficient_evidence: "Needs evidence",
  in_review: "In review",
  changes_requested: "Changes requested",
  rejected: "Rejected",
  approved: "Approved",
};
