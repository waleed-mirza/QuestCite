import "server-only";

import {
  AnswerProviderError,
  estimateCostMicroUsd,
  type AnswerProvider,
} from "@/lib/ai/answer-provider";
import {
  buildDraftingPrompt,
  DraftValidationError,
  draftAnswer,
  insufficientEvidenceDecision,
  type DraftDecision,
} from "@/server/services/drafting";
import {
  RetrievalError,
  type RetrievalOutcome,
} from "@/server/services/retrieval";

export const DEFAULT_CLAIM_BATCH_SIZE = 3;

export type ClaimedAnswerRunItem = {
  itemId: string;
  questionId: string;
  questionOriginal: string;
  questionNormalized: string;
  category: string;
};

export type CompletionInput = {
  organizationId: string;
  runId: string;
  itemId: string;
  decision: DraftDecision | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicroUsd: number;
  errorCode: string | null;
};

export type AnswerRunGateway = {
  claim: (input: {
    organizationId: string;
    runId: string;
    batchSize: number;
  }) => Promise<{ items: ClaimedAnswerRunItem[]; errorCode: string | null }>;
  complete: (input: CompletionInput) => Promise<{ errorCode: string | null }>;
};

export type RetrieveEvidenceForRunItem = (input: {
  organizationId: string;
  questionText: string;
  category: string;
}) => Promise<RetrievalOutcome>;

export type DraftAnswerForRunItem = typeof draftAnswer;

export class AnswerRunProcessingError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "AnswerRunProcessingError";
    this.code = code;
  }
}

export type ProcessNextAnswerRunInput = {
  gateway: AnswerRunGateway;
  organizationId: string;
  runId: string;
  batchSize: number;
  model: string;
  provider: AnswerProvider | null;
  maxInputTokens: number;
  inputTokensUsed: number;
  maxOutputTokens: number;
  retrieveEvidence: RetrieveEvidenceForRunItem;
  draft?: DraftAnswerForRunItem;
};

export type ProcessNextAnswerRunResult = {
  claimed: number;
  completed: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicroUsd: number;
};

/**
 * Processes one short, resumable batch. The gateway is the only code allowed
 * to speak to the run RPCs; this loop never writes tables directly. A provider
 * or retrieval failure is completed as a safe failed item so one bad question
 * does not strand the rest of the claimed batch.
 */
export async function processNextAnswerRun(
  input: ProcessNextAnswerRunInput,
): Promise<ProcessNextAnswerRunResult> {
  const claim = await input.gateway.claim({
    organizationId: input.organizationId,
    runId: input.runId,
    batchSize: input.batchSize,
  });
  if (claim.errorCode !== null) {
    throw new AnswerRunProcessingError(claim.errorCode);
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostMicroUsd = 0;
  let completed = 0;
  let failed = 0;
  const draft = input.draft ?? draftAnswer;
  let accumulatedInputTokens = Math.max(0, input.inputTokensUsed);

  for (const item of claim.items) {
    let outcome: {
      decision: DraftDecision | null;
      errorCode: string | null;
      inputTokens: number;
      outputTokens: number;
    };
    try {
      if (input.provider === null) {
        throw new AnswerRunProcessingError("PROVIDER_UNAVAILABLE");
      }

      const retrieval: RetrievalOutcome = await input.retrieveEvidence({
        organizationId: input.organizationId,
        questionText: item.questionOriginal,
        category: item.category,
      });

      // No evidence is a deterministic abstention. Do not spend a model call
      // asking it to invent an answer for an empty context.
      if (retrieval.evidence.length === 0) {
        outcome = {
          decision: insufficientEvidenceDecision(),
          errorCode: null,
          inputTokens: 0,
          outputTokens: 0,
        };
      } else {
        const estimatedPromptTokens = estimateDraftInputTokens(item.questionOriginal, retrieval);
        if (accumulatedInputTokens + estimatedPromptTokens > input.maxInputTokens) {
          throw new AnswerRunProcessingError("AI_INPUT_LIMIT");
        }

        const result = await draft({
          provider: input.provider,
          questionText: item.questionOriginal,
          evidence: retrieval.evidence,
          maxOutputTokens: input.maxOutputTokens,
        });
        outcome = {
          decision: result.decision,
          errorCode: null,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        };
      }
    } catch (error) {
      const usage = usageFromError(error);
      outcome = {
        decision: null,
        errorCode: safeProcessingCode(error),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      };
    }

    if (outcome.errorCode === null && outcome.decision !== null) {
      await recordSuccess(input, item, outcome.decision, outcome.inputTokens, outcome.outputTokens);
      completed += 1;
    } else {
      await recordFailure(
        input,
        item,
        outcome.errorCode ?? "DRAFT_FAILED",
        outcome.inputTokens,
        outcome.outputTokens,
      );
      failed += 1;
    }

    inputTokens += outcome.inputTokens;
    outputTokens += outcome.outputTokens;
    accumulatedInputTokens += outcome.inputTokens;
    estimatedCostMicroUsd += estimateCostMicroUsd(input.model, outcome.inputTokens, outcome.outputTokens);
  }

  return {
    claimed: claim.items.length,
    completed,
    failed,
    inputTokens,
    outputTokens,
    estimatedCostMicroUsd,
  };
}

function estimateDraftInputTokens(questionText: string, retrieval: RetrievalOutcome): number {
  const prompt = buildDraftingPrompt({ questionText, evidence: retrieval.evidence });
  return Math.ceil((prompt.system.length + prompt.user.length) / 4);
}

async function recordSuccess(
  input: ProcessNextAnswerRunInput,
  item: ClaimedAnswerRunItem,
  decision: DraftDecision,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const result = await input.gateway.complete({
    organizationId: input.organizationId,
    runId: input.runId,
    itemId: item.itemId,
    decision,
    inputTokens,
    outputTokens,
    estimatedCostMicroUsd: estimateCostMicroUsd(input.model, inputTokens, outputTokens),
    errorCode: null,
  });
  if (result.errorCode !== null) {
    throw new AnswerRunProcessingError(result.errorCode);
  }
}

async function recordFailure(
  input: ProcessNextAnswerRunInput,
  item: ClaimedAnswerRunItem,
  errorCode: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const result = await input.gateway.complete({
    organizationId: input.organizationId,
    runId: input.runId,
    itemId: item.itemId,
    decision: null,
    inputTokens,
    outputTokens,
    estimatedCostMicroUsd: estimateCostMicroUsd(input.model, inputTokens, outputTokens),
    errorCode,
  });
  if (result.errorCode !== null) {
    throw new AnswerRunProcessingError(result.errorCode);
  }
}

function usageFromError(error: unknown): { inputTokens: number; outputTokens: number } {
  if (error instanceof DraftValidationError) {
    return { inputTokens: error.inputTokens, outputTokens: error.outputTokens };
  }
  return { inputTokens: 0, outputTokens: 0 };
}

function safeProcessingCode(error: unknown): string {
  if (error instanceof AnswerRunProcessingError) {
    return error.code;
  }
  if (error instanceof AnswerProviderError) {
    return error.code;
  }
  if (error instanceof RetrievalError) {
    return error.code;
  }
  if (error instanceof DraftValidationError) {
    return error.code;
  }
  return "DRAFT_FAILED";
}
