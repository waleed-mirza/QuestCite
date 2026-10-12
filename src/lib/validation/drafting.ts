import { z } from "zod";

/**
 * Model output contract (plan §10 "Model contract"). This is the Zod mirror
 * of the Structured-Output JSON schema the model is forced into — every
 * generation passes through it BEFORE any semantic validation runs, so a
 * malformed or smuggled shape dies at the boundary (AGENTS rule 6).
 *
 * The disposition enum deliberately has NO "approved" value: there is no
 * representation for approval in the contract at all (W5 gate: AI never
 * self-approves — enforced here, in the service, and in the DB state machine).
 */

export const AI_DISPOSITIONS = ["answered", "needs_review", "insufficient_evidence"] as const;
export type AiDisposition = (typeof AI_DISPOSITIONS)[number];

export const modelOutputSchema = z.object({
  answer: z.string(),
  disposition: z.enum(AI_DISPOSITIONS),
  citation_ids: z.array(z.string()),
  review_note: z.string().nullable(),
});

export type ModelOutput = z.infer<typeof modelOutputSchema>;

/** Structured-Output schema sent to the provider (must mirror modelOutputSchema). */
export const MODEL_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "disposition", "citation_ids", "review_note"],
  properties: {
    answer: { type: "string" },
    disposition: { type: "string", enum: AI_DISPOSITIONS },
    citation_ids: {
      type: "array",
      items: { type: "string" },
    },
    review_note: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
  },
} as const;
