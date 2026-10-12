/**
 * Offline resumable-run orchestration. The database RPCs own authorization,
 * state transitions, and citation validation; this service owns the safe
 * retrieve -> draft -> complete loop and guarantees that provider failures
 * become visible failed items instead of leaving work silently processing.
 */

import { describe, expect, it, vi } from "vitest";

import { AnswerProviderError, type AnswerProvider } from "@/lib/ai/answer-provider";
import { DraftValidationError, draftAnswer } from "@/server/services/drafting";
import {
  processNextAnswerRun,
  type AnswerRunGateway,
  type ClaimedAnswerRunItem,
  type CompletionInput,
} from "@/server/services/answer-run";
import type { SelectedEvidence } from "@/server/services/retrieval";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_ID = "44444444-4444-4444-8444-444444444444";

const item: ClaimedAnswerRunItem = {
  itemId: ITEM_ID,
  questionId: "55555555-5555-4555-8555-555555555555",
  questionOriginal: "Is customer data encrypted at rest?",
  questionNormalized: "is customer data encrypted at rest",
  category: "security",
};

const selectedEvidence: SelectedEvidence = {
  sourceType: "document_chunk",
  sourceId: SOURCE_ID,
  documentId: "66666666-6666-4666-8666-666666666666",
  documentTitle: "Security Policy",
  section: "Encryption",
  excerpt: "Customer data is encrypted at rest with AES-256.",
  excerptSha256: "a".repeat(64),
  retrievalScore: 0.91,
  isApprovedAnswer: false,
  isStale: false,
  tagMatched: false,
};

function gatewayFor(
  claimed: ClaimedAnswerRunItem[] = [item],
  onComplete?: (input: CompletionInput) => { errorCode: string | null },
): { gateway: AnswerRunGateway; completions: CompletionInput[] } {
  const completions: CompletionInput[] = [];
  return {
    completions,
    gateway: {
      claim: vi.fn(async () => ({ items: claimed, errorCode: null })),
      complete: vi.fn(async (input: CompletionInput) => {
        completions.push(input);
        return onComplete?.(input) ?? { errorCode: null };
      }),
    },
  };
}

function answerProvider(json: string, inputTokens = 321, outputTokens = 123): AnswerProvider {
  return {
    complete: vi.fn(async () => ({ json, inputTokens, outputTokens })),
  };
}

function baseInput(gateway: AnswerRunGateway) {
  return {
    gateway,
    organizationId: ORG_ID,
    runId: RUN_ID,
    batchSize: 3,
    model: "gpt-5.6-luna",
    provider: answerProvider(JSON.stringify({
      answer: "Yes, AES-256 is used.",
      disposition: "answered",
      citation_ids: [SOURCE_ID],
      review_note: null,
    })),
    maxInputTokens: 120_000,
    inputTokensUsed: 0,
    maxOutputTokens: 500,
    retrieveEvidence: vi.fn(async () => ({ evidence: [selectedEvidence], embeddingAvailable: false })),
    draft: draftAnswer,
  };
}

describe("processNextAnswerRun", () => {
  it("retrieves, drafts, validates, and completes one item with usage and cost", async () => {
    const { gateway, completions } = gatewayFor();
    const result = await processNextAnswerRun(baseInput(gateway));

    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0, inputTokens: 321, outputTokens: 123 });
    expect(result.estimatedCostMicroUsd).toBe(212);
    expect(completions[0]?.errorCode).toBeNull();
    expect(completions[0]?.decision?.citations[0]?.sourceId).toBe(SOURCE_ID);
    expect(completions[0]?.decision?.disposition).toBe("answered");
  });

  it("records provider unavailability as a safe failed item", async () => {
    const { gateway, completions } = gatewayFor();
    const result = await processNextAnswerRun({
      ...baseInput(gateway),
      provider: null,
    });

    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 1 });
    expect(completions[0]).toMatchObject({ decision: null, errorCode: "PROVIDER_UNAVAILABLE" });
  });

  it("turns malformed model output into a failed item and preserves provider usage", async () => {
    const { gateway, completions } = gatewayFor();
    const provider = answerProvider("not json", 17, 9);

    const result = await processNextAnswerRun({
      ...baseInput(gateway),
      provider,
    });

    expect(result).toMatchObject({ claimed: 1, completed: 0, failed: 1, inputTokens: 17, outputTokens: 9 });
    expect(completions[0]).toMatchObject({
      decision: null,
      errorCode: "MODEL_OUTPUT_INVALID",
      inputTokens: 17,
      outputTokens: 9,
    });
  });

  it("continues a batch after a retrieval failure and records only that item as failed", async () => {
    const second = { ...item, itemId: "77777777-7777-4777-8777-777777777777" };
    const { gateway, completions } = gatewayFor([item, second]);
    const retrieveEvidence = vi
      .fn()
      .mockRejectedValueOnce(new AnswerProviderError("PROVIDER_TIMEOUT"))
      .mockResolvedValueOnce({ evidence: [selectedEvidence], embeddingAvailable: false });

    const result = await processNextAnswerRun({
      ...baseInput(gateway),
      retrieveEvidence,
    });

    expect(result).toMatchObject({ claimed: 2, completed: 1, failed: 1 });
    expect(completions.map((completion) => completion.errorCode)).toEqual(["PROVIDER_TIMEOUT", null]);
  });

  it("abstains before calling the provider when retrieval returns no evidence", async () => {
    const { gateway, completions } = gatewayFor();
    const provider = answerProvider(JSON.stringify({
      answer: "A fabricated answer.",
      disposition: "answered",
      citation_ids: [],
      review_note: null,
    }));

    const result = await processNextAnswerRun({
      ...baseInput(gateway),
      provider,
      retrieveEvidence: vi.fn(async () => ({ evidence: [], embeddingAvailable: false })),
    });

    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(completions[0]?.decision).toMatchObject({
      answerText: "",
      disposition: "insufficient_evidence",
      strength: "insufficient",
      citations: [],
    });
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it("fails closed when the estimated prompt exceeds the per-run input budget", async () => {
    const { gateway, completions } = gatewayFor();
    const provider = answerProvider("should not be called");

    const result = await processNextAnswerRun({
      ...baseInput(gateway),
      provider,
      maxInputTokens: 1,
    });

    expect(result.failed).toBe(1);
    expect(completions[0]).toMatchObject({ decision: null, errorCode: "AI_INPUT_LIMIT" });
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it("does not hide a completion gateway failure", async () => {
    const { gateway } = gatewayFor([item], () => ({ errorCode: "RUN_ITEM_NOT_CLAIMED" }));

    await expect(processNextAnswerRun(baseInput(gateway))).rejects.toMatchObject({
      name: "AnswerRunProcessingError",
      code: "RUN_ITEM_NOT_CLAIMED",
    });
  });

  it("exports a typed validation error with its provider usage", () => {
    const error = new DraftValidationError(8, 5);
    expect(error).toBeInstanceOf(DraftValidationError);
    expect(error.inputTokens).toBe(8);
    expect(error.outputTokens).toBe(5);
  });
});
