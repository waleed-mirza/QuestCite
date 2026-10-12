import { z } from "zod";

import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  DOCUMENT_CATEGORY_MAX,
  DOCUMENT_TAGS_MAX,
  DOCUMENT_TAG_MAX,
  DOCUMENT_TITLE_MAX,
} from "@/config/ingestion";

/**
 * Shared Zod schemas for knowledge documents + entries (rule 6: every input
 * validated; rule 1: mirrors DB constraints from migration 0003 so feedback
 * is instant and the database stays the authoritative backstop).
 */

const trimmedNonEmpty = (max: number) => z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(max));

export const documentTagsSchema = z
  .array(trimmedNonEmpty(DOCUMENT_TAG_MAX))
  .max(DOCUMENT_TAGS_MAX)
  .transform((tags) => [...new Set(tags.map((tag) => tag.toLowerCase()))]);

export const documentReviewBySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date")
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be a real date");

/** Upload-intent metadata (file bytes are validated separately, in @/lib/files/validate). */
export const createDocumentUploadSchema = z.strictObject({
  title: trimmedNonEmpty(DOCUMENT_TITLE_MAX),
  category: trimmedNonEmpty(DOCUMENT_CATEGORY_MAX).default("general"),
  tags: documentTagsSchema.default([]),
  reviewBy: documentReviewBySchema.nullable().default(null),
  /** Add a version to an existing document instead of creating a new one. */
  documentId: z.uuid().nullable().default(null),
});

export type CreateDocumentUploadInput = z.output<typeof createDocumentUploadSchema>;

export const documentMimeSchema = z.enum(ALLOWED_DOCUMENT_MIME_TYPES);

export const updateDocumentSchema = z.strictObject({
  title: trimmedNonEmpty(DOCUMENT_TITLE_MAX).optional(),
  category: trimmedNonEmpty(DOCUMENT_CATEGORY_MAX).optional(),
  tags: documentTagsSchema.optional(),
  reviewBy: documentReviewBySchema.nullable().optional(),
});

export type UpdateDocumentInput = z.output<typeof updateDocumentSchema>;

export const KNOWLEDGE_ENTRY_QUESTION_MAX = 500;
export const KNOWLEDGE_ENTRY_ANSWER_MAX = 10000;

export const knowledgeEntryReviewStates = ["draft", "approved", "needs_review", "retired"] as const;
export const knowledgeEntryReviewStateSchema = z.enum(knowledgeEntryReviewStates);

export const saveKnowledgeEntrySchema = z.strictObject({
  question: trimmedNonEmpty(KNOWLEDGE_ENTRY_QUESTION_MAX),
  answer: trimmedNonEmpty(KNOWLEDGE_ENTRY_ANSWER_MAX),
  category: trimmedNonEmpty(DOCUMENT_CATEGORY_MAX).default("general"),
  tags: documentTagsSchema.default([]),
  reviewState: knowledgeEntryReviewStateSchema.default("draft"),
  reviewBy: documentReviewBySchema.nullable().default(null),
  entryId: z.uuid().nullable().default(null),
});

export type SaveKnowledgeEntryInput = z.output<typeof saveKnowledgeEntrySchema>;
