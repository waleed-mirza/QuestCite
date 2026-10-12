import { NextResponse } from "next/server";

/**
 * Route-level allow-list for answer-run failures. Provider/database messages
 * are deliberately collapsed before they reach the browser or a log.
 */
const SAFE_ANSWER_RUN_CODES = new Set([
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "AI_DISABLED",
  "AI_NOT_CONFIGURED",
  "AI_DISABLED_FOR_ORG",
  "QUOTA_EXCEEDED",
  "AI_INPUT_LIMIT",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_FAILED",
  "PROVIDER_RESPONSE_INVALID",
  "MODEL_OUTPUT_INVALID",
  "RETRIEVAL_NOT_FOUND",
  "RETRIEVAL_FORBIDDEN",
  "RETRIEVAL_QUERY_INVALID",
  "RETRIEVAL_FAILED",
  "DRAFT_FAILED",
  "QUESTIONNAIRE_INPUT_INVALID",
  "QUESTIONNAIRE_NOT_FOUND",
  "QUESTIONNAIRE_STATE_INVALID",
  "QUESTION_NOT_FOUND",
  "RUN_ALREADY_ACTIVE",
  "RUN_NO_QUESTIONS",
  "RUN_TOO_LARGE",
  "RUN_QUESTIONS_INELIGIBLE",
  "RUN_START_RACE",
  "RUN_NOT_FOUND",
  "RUN_ITEM_NOT_FOUND",
  "RUN_ITEM_NOT_CLAIMED",
  "RUN_INPUT_INVALID",
  "RUN_CITATIONS_INVALID",
  "RUN_ITEM_WRITE_FAILED",
  "RUN_NOT_ACTIVE",
  "RUN_ITEM_NOT_FAILED",
  "RUN_ITEM_RETRIES_EXHAUSTED",
  "RUN_INTERRUPTED",
  "RUN_RPC_FAILED",
]);

export function safeAnswerRunCode(code: string): string {
  return SAFE_ANSWER_RUN_CODES.has(code) ? code : "RUN_RPC_FAILED";
}

export function answerRunErrorResponse(code: string, status?: number): NextResponse {
  const safeCode = safeAnswerRunCode(code);
  return NextResponse.json(
    { status: "error", code: safeCode },
    { status: status ?? statusForAnswerRunCode(safeCode) },
  );
}

function statusForAnswerRunCode(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "QUOTA_EXCEEDED") return 402;
  if (code === "QUESTIONNAIRE_NOT_FOUND" || code === "RUN_NOT_FOUND" || code === "QUESTION_NOT_FOUND") return 404;
  if (code === "RUN_ALREADY_ACTIVE" || code === "RUN_NOT_ACTIVE" || code === "RUN_ITEM_NOT_CLAIMED") return 409;
  if (code === "AI_DISABLED" || code === "AI_NOT_CONFIGURED" || code === "AI_DISABLED_FOR_ORG") return 503;
  if (code.startsWith("PROVIDER_") || code.startsWith("RETRIEVAL_")) return 502;
  if (code === "RUN_RPC_FAILED" || code === "DRAFT_FAILED") return 500;
  return 400;
}
