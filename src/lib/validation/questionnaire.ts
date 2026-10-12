import { z } from "zod";

import {
  ANSWER_TEXT_MAX,
  COMMENT_TEXT_MAX,
  QUESTION_CATEGORY_MAX,
  QUESTIONNAIRE_CUSTOMER_MAX,
  QUESTIONNAIRE_TITLE_MAX,
} from "@/config/questionnaires";
import { INSPECT_MAX_COLUMNS, INSPECT_MAX_ROWS } from "@/lib/files/questionnaire/types";

/**
 * Shared Zod schemas for questionnaire import + editing (rule 6: every input
 * validated; mirrors the DB constraints from migrations 0010–0013 so feedback
 * is instant and the database stays the authoritative backstop).
 *
 * NOTE: the imported caps come from the CLIENT-SAFE types module (inspect.ts
 * is server-only and must never enter a client bundle — rule 9).
 */

const trimmedNonEmpty = (max: number) => z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(max));

// Stricter than Date.parse, which silently rolls invalid dates over
// ("2026-02-30" parses as March 2): round-trip through ISO to reject them —
// the DB date column would reject the insert with an unmapped error.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "must be a real date");

/** Upload-intent metadata (file bytes are validated separately, in lib/files/questionnaire/validate). */
export const createQuestionnaireUploadSchema = z.strictObject({
  title: trimmedNonEmpty(QUESTIONNAIRE_TITLE_MAX),
  customer: z.string().max(QUESTIONNAIRE_CUSTOMER_MAX).default(""),
  dueDate: isoDate.nullable().default(null),
});

export type CreateQuestionnaireUploadInput = z.output<typeof createQuestionnaireUploadSchema>;

/** CSV transport metadata recorded on questionnaire_files (migration 0013). */
export const csvFileMetadataSchema = z.strictObject({
  delimiter: z.enum([",", ";", "\t", "|"]),
  bom: z.boolean(),
});
export const xlsxFileMetadataSchema = z.strictObject({}).strict();

/** User-confirmed column mapping. Detection output only ever PREFILLS this. */
export const confirmMappingSchema = z.strictObject({
  questionnaireId: z.uuid(),
  sheetName: trimmedNonEmpty(200),
  headerRowIndex: z.number().int().min(-1).max(INSPECT_MAX_ROWS),
  questionColumn: z.number().int().min(0).max(INSPECT_MAX_COLUMNS - 1),
  answerColumn: z.number().int().min(0).max(INSPECT_MAX_COLUMNS - 1).nullable(),
  notesColumn: z.number().int().min(0).max(INSPECT_MAX_COLUMNS - 1).nullable(),
});

export type ConfirmMappingInput = z.output<typeof confirmMappingSchema>;

export const answerStatusActionSchema = z.enum(["in_review", "approved", "changes_requested", "rejected"]);

export const answerTextSchema = trimmedNonEmpty(ANSWER_TEXT_MAX);
export const commentBodySchema = trimmedNonEmpty(COMMENT_TEXT_MAX);
export const questionCategorySchema = trimmedNonEmpty(QUESTION_CATEGORY_MAX);

/** Bulk operation batch (mirrors the RPC's 1..1000 cardinality check). */
export const questionIdsSchema = z.array(z.uuid()).min(1).max(1000);
