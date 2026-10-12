import { describe, expect, it } from "vitest";

import {
  answerStatusActionSchema,
  answerTextSchema,
  commentBodySchema,
  confirmMappingSchema,
  createQuestionnaireUploadSchema,
  csvFileMetadataSchema,
  questionCategorySchema,
  questionIdsSchema,
  xlsxFileMetadataSchema,
} from "@/lib/validation/questionnaire";

describe("createQuestionnaireUploadSchema", () => {
  it("trims the title, defaults customer/dueDate, and rejects empties", () => {
    const parsed = createQuestionnaireUploadSchema.safeParse({ title: "  SOC 2  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ title: "SOC 2", customer: "", dueDate: null });
    }
    expect(createQuestionnaireUploadSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(createQuestionnaireUploadSchema.safeParse({}).success).toBe(false);
  });

  it("validates the due date shape and rejects unknown keys", () => {
    expect(
      createQuestionnaireUploadSchema.safeParse({ title: "t", dueDate: "2026-12-31" }).success,
    ).toBe(true);
    expect(
      createQuestionnaireUploadSchema.safeParse({ title: "t", dueDate: "31-12-2026" }).success,
    ).toBe(false);
    expect(
      createQuestionnaireUploadSchema.safeParse({ title: "t", dueDate: "2026-02-30" }).success,
    ).toBe(false);
    expect(createQuestionnaireUploadSchema.safeParse({ title: "t", extra: 1 }).success).toBe(false);
  });
});

describe("file metadata schemas (migration 0013 shape)", () => {
  it("accepts the csv pair with a supported delimiter", () => {
    expect(csvFileMetadataSchema.safeParse({ delimiter: ";", bom: true }).success).toBe(true);
    expect(csvFileMetadataSchema.safeParse({ delimiter: "\t", bom: false }).success).toBe(true);
    expect(csvFileMetadataSchema.safeParse({ delimiter: "!!", bom: false }).success).toBe(false);
    expect(csvFileMetadataSchema.safeParse({ delimiter: "," }).success).toBe(false);
    expect(csvFileMetadataSchema.safeParse({ delimiter: ",", bom: "yes" }).success).toBe(false);
  });

  it("requires xlsx metadata to be exactly empty", () => {
    expect(xlsxFileMetadataSchema.safeParse({}).success).toBe(true);
    expect(xlsxFileMetadataSchema.safeParse({ delimiter: "," }).success).toBe(false);
  });
});

describe("confirmMappingSchema", () => {
  const valid = {
    questionnaireId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    sheetName: "Sheet1",
    headerRowIndex: 0,
    questionColumn: 0,
    answerColumn: null,
    notesColumn: null,
  };

  it("accepts the detection-shaped payload including the headerless -1 row", () => {
    expect(confirmMappingSchema.safeParse({ ...valid, headerRowIndex: -1 }).success).toBe(true);
    expect(confirmMappingSchema.safeParse(valid).success).toBe(true);
  });

  it("binds coordinates to the inspection caps and requires a uuid", () => {
    expect(confirmMappingSchema.safeParse({ ...valid, questionColumn: 63 }).success).toBe(true);
    expect(confirmMappingSchema.safeParse({ ...valid, questionColumn: 64 }).success).toBe(false);
    expect(confirmMappingSchema.safeParse({ ...valid, headerRowIndex: -2 }).success).toBe(false);
    expect(confirmMappingSchema.safeParse({ ...valid, answerColumn: 1.5 }).success).toBe(false);
    expect(confirmMappingSchema.safeParse({ ...valid, questionnaireId: "nope" }).success).toBe(false);
    expect(confirmMappingSchema.safeParse({ ...valid, questionColumn: null }).success).toBe(false);
  });
});

describe("answer/comment/bulk schemas", () => {
  it("trims answers and enforces the 10,000 ceiling", () => {
    const parsed = answerTextSchema.safeParse("  AES-256 at rest.  ");
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toBe("AES-256 at rest.");
    }
    expect(answerTextSchema.safeParse("   ").success).toBe(false);
    expect(answerTextSchema.safeParse("a".repeat(10_000)).success).toBe(true);
    expect(answerTextSchema.safeParse("a".repeat(10_001)).success).toBe(false);
  });

  it("enforces comment length and the allowed status set", () => {
    expect(commentBodySchema.safeParse("x".repeat(2000)).success).toBe(true);
    expect(commentBodySchema.safeParse("x".repeat(2001)).success).toBe(false);
    expect(answerStatusActionSchema.safeParse("approved").success).toBe(true);
    expect(answerStatusActionSchema.safeParse("drafted").success).toBe(false); // AI-only
    expect(answerStatusActionSchema.safeParse("answered").success).toBe(false); // not a transition target
  });

  it("bounds bulk batches at 1..1000 uuids", () => {
    const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    expect(questionIdsSchema.safeParse([id]).success).toBe(true);
    expect(questionIdsSchema.safeParse([]).success).toBe(false);
    expect(questionIdsSchema.safeParse(Array.from({ length: 1001 }, () => id)).success).toBe(false);
    expect(questionIdsSchema.safeParse(["not-a-uuid"]).success).toBe(false);
  });

  it("trims categories and enforces the 1..80 band (mirrors the RPC check)", () => {
    const parsed = questionCategorySchema.safeParse("  Network security  ");
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toBe("Network security");
    }
    expect(questionCategorySchema.safeParse("   ").success).toBe(false);
    expect(questionCategorySchema.safeParse("x".repeat(80)).success).toBe(true);
    expect(questionCategorySchema.safeParse("x".repeat(81)).success).toBe(false);
  });
});
