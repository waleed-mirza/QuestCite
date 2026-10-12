/**
 * Client-safe questionnaire constants (plan §9/§18-W4).
 *
 * Mirrors the hard ceilings in `private.questionnaire_limits` (migration
 * 0010): the database remains authoritative — these values exist so the UI
 * can give instant feedback before a byte is uploaded. Drift surfaces as a
 * mapped database error code, never as silently accepted input.
 *
 * MAY be imported from Client Components. Anything that needs secrets or the
 * workbook parser belongs in server-only modules under src/lib.
 */

/** Hard per-file ceiling; also enforced by the storage bucket + DB checks. */
export const MAX_QUESTIONNAIRE_FILE_BYTES = 10 * 1024 * 1024;

/** MIME allowlist — must stay in sync with the storage bucket + RPC checks. */
export const ALLOWED_QUESTIONNAIRE_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
] as const;

export type QuestionnaireMimeType = (typeof ALLOWED_QUESTIONNAIRE_MIME_TYPES)[number];

/** Workbook formats (plan §9: .xlsx and .csv only — no .xls/.xlsm, ever). */
export type QuestionnaireFormat = "xlsx" | "csv";

/** File extensions accepted per format (used for the extension↔magic check). */
export const QUESTIONNAIRE_EXTENSIONS_BY_FORMAT: Record<QuestionnaireFormat, readonly string[]> = {
  xlsx: [".xlsx"],
  csv: [".csv"],
};

/** Database-enforced import ceiling (private.questionnaire_limits). */
export const MAX_QUESTIONS_PER_IMPORT = 1000;

/** Text ceilings (also DB CHECK backstops). */
export const QUESTION_TEXT_MAX = 4000;
export const ANSWER_TEXT_MAX = 10000;
export const COMMENT_TEXT_MAX = 2000;
export const QUESTIONNAIRE_TITLE_MAX = 200;
export const QUESTIONNAIRE_CUSTOMER_MAX = 200;
export const QUESTION_CATEGORY_MAX = 80;
export const QUESTIONNAIRE_FILENAME_MAX = 200;

/** PRD §7.1 questionnaire lifecycle (subset usable until W5/W6 UI arrives). */
export const questionnaireStatuses = [
  "importing",
  "mapping",
  "active",
  "in_review",
  "completed",
  "exported",
  "archived",
] as const;

export type QuestionnaireStatus = (typeof questionnaireStatuses)[number];
