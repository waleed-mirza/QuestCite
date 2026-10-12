/**
 * Client-safe copy for SAFE failure codes (rule 8/plan §16): the server sends
 * constant codes only — never file content, parser output, storage paths, or
 * raw database messages. Every surface maps codes through this module so the
 * wording stays consistent.
 */

export const QUESTIONNAIRE_CODE_COPY: Record<string, string> = {
  // upload gate
  QUESTIONNAIRE_INPUT_INVALID: "Check the title and fields — something is missing or too long.",
  QUESTIONNAIRE_TYPE_UNSUPPORTED: "That file type isn't supported. Use .xlsx or .csv.",
  QUESTIONNAIRE_TOO_LARGE: "Files are limited to 10 MB.",
  QUESTIONNAIRE_EMPTY: "That file is empty.",
  EXTENSION_MISMATCH: "The file's contents don't match its extension.",
  FILENAME_INVALID: "Choose a simpler file name.",
  ENCODING_UNSUPPORTED: "CSV files must be UTF-8 (or UTF-16 with a byte-order mark).",
  ORG_INACTIVE: "This workspace is deactivated.",
  FORBIDDEN: "You don't have permission to do that here.",
  AUTH_REQUIRED: "Your session expired — sign in again.",
  STORAGE_UPLOAD_FAILED: "The file could not be stored. Please try again.",
  UPLOAD_FAILED: "Something went wrong. Please try again.",
  // parsing / mapping
  WORKBOOK_MACROS_UNSUPPORTED: "Macro-enabled workbooks aren't supported. Save as .xlsx without macros.",
  WORKBOOK_ENCRYPTED: "Encrypted workbooks aren't supported. Remove password protection and re-save.",
  WORKBOOK_PARSE_FAILED: "The workbook could not be read. Re-save it as .xlsx or .csv and try again.",
  WORKBOOK_EMPTY: "That workbook has no readable content.",
  MAPPING_INPUT_INVALID: "That column mapping isn't valid — adjust the selection and confirm again.",
  MAPPING_SHEET_MISSING: "The chosen sheet is no longer part of this workbook.",
  MAPPING_NO_QUESTIONS: "No question text found under the chosen column. Check the mapping.",
  MAPPING_TOO_MANY_QUESTIONS: "This file has more than 1000 questions — split it and import in parts.",
  MAPPING_DUPLICATE_CELL: "Two imported rows point at the same cell. Check the mapping.",
  QUESTIONNAIRE_NOT_FOUND: "This questionnaire no longer exists.",
  QUESTIONNAIRE_STATE_INVALID: "This questionnaire's state changed — reload the page and try again.",
  // answers
  QUESTION_NOT_FOUND: "This question no longer exists.",
  ANSWER_INPUT_INVALID: "Answers must contain text (max 10,000 characters).",
  ANSWER_CONFLICT: "This answer changed elsewhere. Copy your text, then reload before saving.",
  ANSWER_TRANSITION_INVALID: "That status change isn't allowed from the current state.",
  ANSWER_NOT_FOUND: "There's no answer content to move yet — write an answer first.",
  COMMENT_INPUT_INVALID: "Comments must contain text (max 2,000 characters).",
  QUESTION_INPUT_INVALID: "That value isn't valid for this field.",
  ASSIGNEE_INVALID: "Assignees must be owners, admins, or reviewers of this workspace.",
  // review workflow + export (W6)
  QUESTIONNAIRE_NOT_RESOLVED: "Every question needs a decision before export — finish or consciously blank the outstanding ones.",
  EXPORT_MAPPING_INVALID: "The original file no longer matches this questionnaire's mapping. Re-import the file to continue.",
  EXPORT_SHEET_MISSING: "A sheet this questionnaire was mapped from is missing from the original file.",
  EXPORT_VERIFY_FAILED: "The exported workbook failed its reopen check and was not saved. Please try again.",
  EXPORT_SUMMARY_UNSUPPORTED: "A summary sheet is only available for .xlsx exports.",
  EXPORT_DUPLICATE: "This export was already recorded. Reload to see it.",
  EXPORT_INPUT_INVALID: "The export could not be recorded — reload and try again.",
  EXPORT_NOT_FOUND: "That export no longer exists.",
  EXPORT_FAILED: "The export could not be completed. Please try again.",
  STORAGE_UNAVAILABLE: "The original file could not be read from storage. Please try again.",
  DOWNLOAD_FAILED: "The download could not be started. Please try again.",
  ANSWER_BULK_STATE_CHANGED: "Some answers changed while you were working — nothing was applied. Reload and try again.",
  // AI drafting (safe route/RPC codes only)
  AI_DISABLED: "AI drafting is disabled for this deployment.",
  AI_NOT_CONFIGURED: "AI drafting is not configured on this deployment.",
  AI_DISABLED_FOR_ORG: "AI drafting is disabled for this workspace.",
  QUOTA_EXCEEDED: "This workspace has reached its plan limit. Upgrade or try again next period.",
  AI_INPUT_LIMIT: "This run reached its token limit. Resume with fewer questions.",
  PROVIDER_UNAVAILABLE: "The drafting provider is unavailable. Try again later.",
  PROVIDER_TIMEOUT: "Drafting timed out. Retry the failed questions.",
  PROVIDER_FAILED: "The drafting provider returned an error. Retry the failed questions.",
  PROVIDER_RESPONSE_INVALID: "The drafting provider returned an invalid response. Retry the failed questions.",
  MODEL_OUTPUT_INVALID: "The draft could not be validated. Retry the failed question.",
  RETRIEVAL_NOT_FOUND: "The evidence could not be found. Check the workspace evidence.",
  RETRIEVAL_FORBIDDEN: "The evidence is not available to this workspace.",
  RETRIEVAL_QUERY_INVALID: "The evidence search was invalid. Try again.",
  RETRIEVAL_FAILED: "Evidence search failed. Retry the failed questions.",
  DRAFT_FAILED: "This draft failed safely. Retry the failed question.",
  RUN_RPC_FAILED: "The drafting run could not continue. Try again.",
  RUN_INTERRUPTED: "A previous drafting attempt was interrupted. Retry the failed question.",
  RUN_ITEM_NOT_CLAIMED: "That drafting item is no longer active. Reload and try again.",
  RUN_NOT_ACTIVE: "This drafting run is no longer active.",
  RUN_ALREADY_ACTIVE: "A drafting run is already active for this questionnaire.",
  RUN_NO_QUESTIONS: "No eligible questions are available for drafting.",
  RUN_TOO_LARGE: "This run is too large. Select fewer questions.",
  RUN_QUESTIONS_INELIGIBLE: "One or more selected questions cannot be drafted now.",
  RUN_ITEM_RETRIES_EXHAUSTED: "This question has reached its retry limit.",
  RUN_INPUT_INVALID: "The drafting request is not valid.",
  RUN_CITATIONS_INVALID: "The draft citations could not be validated.",
  RUN_ITEM_WRITE_FAILED: "The draft could not be saved. Retry the failed question.",
};

export function questionnaireCopyFor(code: string | undefined): string {
  if (code === undefined) {
    return QUESTIONNAIRE_CODE_COPY.UPLOAD_FAILED ?? "Something went wrong.";
  }
  return QUESTIONNAIRE_CODE_COPY[code] ?? QUESTIONNAIRE_CODE_COPY.UPLOAD_FAILED ?? "Something went wrong.";
}
