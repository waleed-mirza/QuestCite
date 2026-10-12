import { z } from "zod";

import { slugSchema } from "@/lib/validation/org";

const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);

/** JSON request contracts for the client-driven resumable run endpoints. */
export const answerRunStartRequestSchema = z.strictObject({
  orgSlug: slugSchema,
  questionIds: z.array(z.uuid()).min(1).max(250).optional(),
  /** HTTP callers must always supply a replay key; DB-level fixtures may omit it. */
  idempotencyKey: idempotencyKeySchema,
});

export const answerRunNextRequestSchema = z.strictObject({
  orgSlug: slugSchema,
  batchSize: z.number().int().min(1).max(10).default(3),
});

export const answerRunCancelRequestSchema = z.strictObject({
  orgSlug: slugSchema,
});

export const answerRunRetryRequestSchema = z.strictObject({
  orgSlug: slugSchema,
  itemId: z.uuid(),
});

export type AnswerRunStartRequest = z.output<typeof answerRunStartRequestSchema>;
