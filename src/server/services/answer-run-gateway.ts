import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import type {
  AnswerRunGateway,
  ClaimedAnswerRunItem,
  CompletionInput,
} from "@/server/services/answer-run";

type CompleteArgs = Database["public"]["Functions"]["complete_answer_run_item"]["Args"];
type CompleteArgsNullable = Omit<
  CompleteArgs,
  "p_disposition" | "p_answer_text" | "p_review_note" | "p_strength" | "p_error_code"
> & {
  p_disposition: CompleteArgs["p_disposition"] | null;
  p_answer_text: string | null;
  p_review_note: string | null;
  p_strength: CompleteArgs["p_strength"] | null;
  p_error_code: string | null;
};

/**
 * Supabase RPC adapter. Keeping this boundary separate makes the run loop
 * offline-testable and confines the generated-types nullable-argument gap to
 * one reviewed assertion, matching the existing RLS test wrapper.
 */
export function createAnswerRunGateway(supabase: SupabaseClient<Database>): AnswerRunGateway {
  return {
    async claim(input) {
      const { data, error } = await supabase.rpc("claim_answer_run_items", {
        p_organization_id: input.organizationId,
        p_run_id: input.runId,
        p_batch_size: input.batchSize,
      });
      return {
        items: (data ?? []).map((row): ClaimedAnswerRunItem => ({
          itemId: row.item_id,
          questionId: row.question_id,
          questionOriginal: row.question_original,
          questionNormalized: row.question_normalized,
          category: row.category,
        })),
        errorCode: error === null ? null : safeAnswerRunRpcCode(error.message),
      };
    },

    async complete(input: CompletionInput) {
      const args: CompleteArgsNullable = {
        p_organization_id: input.organizationId,
        p_run_id: input.runId,
        p_item_id: input.itemId,
        p_disposition: input.decision?.disposition ?? null,
        // Abstentions carry "" in the app decision (insufficientEvidenceDecision);
        // the RPC requires NULL text for insufficient_evidence (0014's
        // RUN_INPUT_INVALID pairing) — same boundary-normalization class as
        // the citation keys below.
        p_answer_text:
          input.decision === null || input.decision.disposition === "insufficient_evidence"
            ? null
            : input.decision.answerText,
        p_review_note: input.decision?.reviewNote ?? null,
        p_strength: input.decision?.strength ?? null,
        // The decision carries camelCase app types; the RPC's jsonb contract
        // is snake_case (0014 reads `source_type`, `source_id`, …). Found by
        // the W6 live workflow verification: passing the decision's citations
        // verbatim made EVERY real completion fail RUN_CITATIONS_INVALID —
        // the app-level eval checked citations before this boundary and the
        // RLS tests hand-built snake_case, so only a live end-to-end run
        // could catch it.
        p_citations: (input.decision?.citations ?? []).map((citation) => ({
          source_type: citation.sourceType,
          source_id: citation.sourceId,
          excerpt_sha256: citation.excerptSha256,
          retrieval_score: citation.retrievalScore,
          position: citation.position,
        })),
        p_input_tokens: input.inputTokens,
        p_output_tokens: input.outputTokens,
        p_estimated_cost_micro_usd: input.estimatedCostMicroUsd,
        p_error_code: input.errorCode,
      };
      // Generated Supabase Args types represent nullable Postgres parameters
      // as required values. The SQL function deliberately accepts NULL for
      // failure/abstention paths; this is the one narrow adapter assertion.
      const { error } = await supabase.rpc("complete_answer_run_item", args as CompleteArgs);
      return { errorCode: error === null ? null : safeAnswerRunRpcCode(error.message) };
    },
  };
}

const SAFE_RPC_CODES = new Set([
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "AI_DISABLED_FOR_ORG",
  "QUOTA_EXCEEDED",
  "QUESTIONNAIRE_STATE_INVALID",
  "QUESTIONNAIRE_NOT_FOUND",
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
  "QUESTION_NOT_FOUND",
  "ANSWER_TRANSITION_INVALID",
]);

export function safeAnswerRunRpcCode(message: string): string {
  const code = message.trim();
  return SAFE_RPC_CODES.has(code) ? code : "RUN_RPC_FAILED";
}
