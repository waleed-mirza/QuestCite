import { describe, expect, it } from "vitest";

import {
  answerRunNextRequestSchema,
  answerRunRetryRequestSchema,
  answerRunStartRequestSchema,
} from "@/lib/validation/answer-runs";

const QUESTION_ID = "11111111-1111-4111-8111-111111111111";

describe("answer run request schemas", () => {
  it("accepts a valid start request and defaults optional selection to all", () => {
    const result = answerRunStartRequestSchema.safeParse({
      orgSlug: "acme-security",
      idempotencyKey: "run-2026-09-03-001",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.questionIds).toBeUndefined();
    }
  });

  it("rejects malformed slugs, empty selections, oversized selections, and unknown keys", () => {
    expect(answerRunStartRequestSchema.safeParse({ orgSlug: "api", questionIds: [], idempotencyKey: "run-2026-09-03-001" }).success).toBe(false);
    expect(answerRunStartRequestSchema.safeParse({ orgSlug: "Acme Security" }).success).toBe(false);
    expect(answerRunStartRequestSchema.safeParse({ orgSlug: "acme-security", idempotencyKey: "run-2026-09-03-001", extra: true }).success).toBe(false);
    expect(
      answerRunStartRequestSchema.safeParse({
        orgSlug: "acme-security",
        idempotencyKey: "run-2026-09-03-001",
        questionIds: Array.from({ length: 251 }, () => QUESTION_ID),
      }).success,
    ).toBe(false);
  });

  it("defaults the claim batch and caps it at the database limit", () => {
    const result = answerRunNextRequestSchema.safeParse({ orgSlug: "acme-security" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.batchSize).toBe(3);
    }
    expect(answerRunNextRequestSchema.safeParse({ orgSlug: "acme-security", batchSize: 11 }).success).toBe(false);
  });

  it("requires a valid item id for retry", () => {
    expect(answerRunRetryRequestSchema.safeParse({ orgSlug: "acme-security", itemId: QUESTION_ID }).success).toBe(true);
    expect(answerRunRetryRequestSchema.safeParse({ orgSlug: "acme-security", itemId: "not-an-id" }).success).toBe(false);
  });
});
