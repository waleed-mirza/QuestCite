import { describe, expect, it } from "vitest";

import {
  createDocumentUploadSchema,
  knowledgeEntryReviewStateSchema,
  saveKnowledgeEntrySchema,
  updateDocumentSchema,
} from "@/lib/validation/document";

describe("createDocumentUploadSchema", () => {
  it("accepts a full valid payload and applies defaults", () => {
    const result = createDocumentUploadSchema.safeParse({
      title: "  Access Control Policy  ",
      tags: ["SOC 2", "Product"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Access Control Policy");
      expect(result.data.category).toBe("general");
      expect(result.data.tags).toEqual(["soc 2", "product"]);
      expect(result.data.reviewBy).toBeNull();
      expect(result.data.documentId).toBeNull();
    }
  });

  it("rejects empty titles, oversized tags arrays, and bad dates", () => {
    expect(createDocumentUploadSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(
      createDocumentUploadSchema.safeParse({ title: "t", tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }).success,
    ).toBe(false);
    expect(createDocumentUploadSchema.safeParse({ title: "t", reviewBy: "2026-13-40" }).success).toBe(false);
    expect(createDocumentUploadSchema.safeParse({ title: "t", reviewBy: "01/02/2026" }).success).toBe(false);
  });

  it("rejects a malformed documentId", () => {
    expect(createDocumentUploadSchema.safeParse({ title: "t", documentId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("updateDocumentSchema", () => {
  it("accepts partial updates", () => {
    expect(updateDocumentSchema.safeParse({}).success).toBe(true);
    expect(updateDocumentSchema.safeParse({ state: "archived" }).success).toBe(false); // state not updatable here
    expect(updateDocumentSchema.safeParse({ title: "New title" }).success).toBe(true);
  });
});

describe("saveKnowledgeEntrySchema", () => {
  it("accepts a valid entry and defaults review state to draft", () => {
    const result = saveKnowledgeEntrySchema.safeParse({ question: "Is data encrypted?", answer: "Yes, AES-256." });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reviewState).toBe("draft");
      expect(result.data.tags).toEqual([]);
    }
  });

  it("rejects unknown review states and empty answers", () => {
    expect(
      saveKnowledgeEntrySchema.safeParse({ question: "q", answer: "a", reviewState: "auto-approved" }).success,
    ).toBe(false);
    expect(saveKnowledgeEntrySchema.safeParse({ question: "q", answer: "  " }).success).toBe(false);
  });

  it("matches the DB enum exactly", () => {
    for (const state of ["draft", "approved", "needs_review", "retired"] as const) {
      expect(knowledgeEntryReviewStateSchema.safeParse(state).success).toBe(true);
    }
  });
});
