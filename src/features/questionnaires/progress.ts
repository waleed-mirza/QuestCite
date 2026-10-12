import type { Database } from "@/types/database.types";

/**
 * Questionnaire progress (plan §W4: the data table carries "progress").
 *
 * A question counts as RESOLVED when it is export-eligible in the D012
 * sense: it holds an answer workflow state beyond a draft (answered or any
 * review state), carries an AI disposition, or is a conscious blank-by-choice.
 * The AI-drafting states (generating/drafted) and the initial empty state do
 * not count — no usable answer exists yet. Pure logic, so the counter is unit
 * tested directly; the read model (server.ts) only fetches the rows.
 */

type AnswerStatus = Database["public"]["Enums"]["answer_status"];

const RESOLVED_STATUSES: readonly AnswerStatus[] = [
  "answered",
  "insufficient_evidence",
  "in_review",
  "changes_requested",
  "rejected",
  "approved",
];

/** The two question columns the counter needs (the wire shape the read model selects). */
export type QuestionProgressRow = {
  status: AnswerStatus;
  blank_by_choice: boolean;
};

export type QuestionnaireProgress = {
  resolved: number;
  total: number;
};

/** D023 resolved = export-eligible: a deliberate decision or a conscious blank. */
export function isQuestionResolved(row: QuestionProgressRow): boolean {
  return row.blank_by_choice || RESOLVED_STATUSES.includes(row.status);
}

export function countQuestionnaireProgress(rows: QuestionProgressRow[]): QuestionnaireProgress {
  let resolved = 0;
  for (const row of rows) {
    if (isQuestionResolved(row)) {
      resolved += 1;
    }
  }
  return { resolved, total: rows.length };
}
