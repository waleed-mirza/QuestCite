import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CompletionInput } from "@/server/services/answer-run";

/**
 * Gateway boundary (W6 regression): the drafting decision's camelCase
 * citations MUST map onto the complete_answer_run_item jsonb contract's
 * snake_case keys — the DB reads `source_type`/`source_id`/`excerpt_sha256`/
 * `retrieval_score`/`position`. Passing the decision through verbatim made
 * every real completion fail RUN_CITATIONS_INVALID (found by the W6 live
 * workflow verification, 2026-09-03).
 */

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

vi.mock("@/lib/observability/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({}),
}));

import { createAnswerRunGateway } from "@/server/services/answer-run-gateway";

const supabase = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return { data: null, error: null };
  },
} as unknown as Parameters<typeof createAnswerRunGateway>[0];

const decision: CompletionInput["decision"] = {
  disposition: "answered",
  answerText: "AES-256 at rest.",
  strength: "high",
  reviewNote: null,
  citations: [
    {
      sourceType: "knowledge_entry",
      sourceId: "0b9c8a44-0000-4000-8000-000000000001",
      excerptSha256: "a".repeat(64),
      retrievalScore: 0.92,
      position: 0,
    },
  ],
};

beforeEach(() => {
  rpcCalls.length = 0;
});

describe("createAnswerRunGateway.complete", () => {
  it("maps decision citations onto the RPC's snake_case jsonb contract", async () => {
    const gateway = createAnswerRunGateway(supabase);
    await gateway.complete({
      organizationId: "org-1",
      runId: "run-1",
      itemId: "item-1",
      decision,
      inputTokens: 10,
      outputTokens: 5,
      estimatedCostMicroUsd: 1,
      errorCode: null,
    });

    expect(rpcCalls).toHaveLength(1);
    const args = rpcCalls[0]?.args as Record<string, unknown>;
    expect(args.p_disposition).toBe("answered");
    const citations = args.p_citations as Array<Record<string, unknown>>;
    expect(citations).toEqual([
      {
        source_type: "knowledge_entry",
        source_id: "0b9c8a44-0000-4000-8000-000000000001",
        excerpt_sha256: "a".repeat(64),
        retrieval_score: 0.92,
        position: 0,
      },
    ]);
    // No camelCase keys may leak through — the DB treats unknown shapes as
    // RUN_CITATIONS_INVALID.
    expect(JSON.stringify(citations)).not.toContain("sourceType");
    expect(JSON.stringify(citations)).not.toContain("excerptSha256");
  });

  it("sends an empty citation array (never undefined) for abstentions", async () => {
    const gateway = createAnswerRunGateway(supabase);
    await gateway.complete({
      organizationId: "org-1",
      runId: "run-1",
      itemId: "item-1",
      decision: {
        disposition: "insufficient_evidence",
        answerText: "",
        strength: "insufficient",
        reviewNote: null,
        citations: [],
      },
      inputTokens: 1,
      outputTokens: 0,
      estimatedCostMicroUsd: 0,
      errorCode: null,
    });
    const args = rpcCalls[0]?.args as Record<string, unknown>;
    expect(args.p_citations).toEqual([]);
    expect(args.p_answer_text).toBeNull();
  });
});
