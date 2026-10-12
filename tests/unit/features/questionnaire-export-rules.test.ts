import { describe, expect, it } from "vitest";

import {
  buildExportFilename,
  exportTextFor,
  isQuestionExportEligible,
  summarizeExportReadiness,
} from "@/features/questionnaires/export-rules";

/**
 * Export rules (plan §W6, D012/D021/D023): the eligibility matrix, the
 * readiness counts that drive the panel's blocked copy, the per-status export
 * text, and the safe export filename. These are the same rules the export
 * service and the 0018 DB gate enforce — pinned here so UI copy can never
 * drift from what the pipeline will actually do.
 */

describe("question export eligibility (D012/D021/D023)", () => {
  it("accepts every deliberate decision state", () => {
    for (const status of [
      "answered",
      "insufficient_evidence",
      "in_review",
      "changes_requested",
      "rejected",
      "approved",
    ] as const) {
      expect(isQuestionExportEligible({ status, blank_by_choice: false }), status).toBe(true);
    }
  });

  it("rejects unreviewed AI drafts, in-flight runs, and untouched questions", () => {
    for (const status of ["empty", "generating", "drafted"] as const) {
      expect(isQuestionExportEligible({ status, blank_by_choice: false }), status).toBe(false);
    }
  });

  it("a conscious blank is always eligible, whatever the underlying status", () => {
    expect(isQuestionExportEligible({ status: "empty", blank_by_choice: true })).toBe(true);
    expect(isQuestionExportEligible({ status: "drafted", blank_by_choice: true })).toBe(true);
  });
});

describe("export readiness summary", () => {
  it("counts eligible, unresolved, approved, and deliberate blanks", () => {
    const readiness = summarizeExportReadiness([
      { status: "approved", blank_by_choice: false },
      { status: "answered", blank_by_choice: false },
      { status: "in_review", blank_by_choice: false },
      { status: "drafted", blank_by_choice: false },
      { status: "empty", blank_by_choice: false },
      { status: "empty", blank_by_choice: true },
      { status: "insufficient_evidence", blank_by_choice: false },
    ]);
    expect(readiness).toEqual({
      total: 7,
      eligible: 5,
      unresolved: 2,
      approved: 1,
      emptyCellCount: 2,
    });
  });

  it("an empty questionnaire blocks the export (nothing to write)", () => {
    expect(summarizeExportReadiness([])).toMatchObject({ total: 0, unresolved: 0 });
  });
});

describe("export text per status", () => {
  it("writes the current answer text for content-bearing states", () => {
    expect(
      exportTextFor({ status: "approved", blank_by_choice: false, current_text: "Yes, AES-256." }),
    ).toBe("Yes, AES-256.");
    expect(
      exportTextFor({ status: "changes_requested", blank_by_choice: false, current_text: "Working text." }),
    ).toBe("Working text.");
  });

  it("a conscious blank wins over leftover text — it is the later declaration", () => {
    expect(
      exportTextFor({ status: "answered", blank_by_choice: true, current_text: "Old answer." }),
    ).toBe("");
  });

  it("abstention markers export as empty cells (they carry no text by trigger)", () => {
    expect(exportTextFor({ status: "insufficient_evidence", blank_by_choice: false, current_text: "" })).toBe("");
  });
});

describe("safe export filename", () => {
  const stamp = new Date("2026-09-03T12:00:00Z");

  it("derives a dated, extension-correct name from the original", () => {
    expect(buildExportFilename("vendor-questionnaire.xlsx", "xlsx", stamp)).toBe(
      "vendor-questionnaire-answers-20260903.xlsx",
    );
    expect(buildExportFilename("questions.csv", "csv", stamp)).toBe("questions-answers-20260903.csv");
  });

  it("derives the name from the original's basename only, minus control characters", () => {
    // Everything before the final separator is dropped — the export name can
    // never smuggle a path from the stored object key.
    expect(buildExportFilename("..\\evil\\path\\q.xlsx", "xlsx", stamp)).toBe(
      "q-answers-20260903.xlsx",
    );
    expect(buildExportFilename("q\x00\x1f.xlsx", "xlsx", stamp)).toBe("q-answers-20260903.xlsx");
  });

  it("falls back to a stable stem when nothing usable remains, and caps length", () => {
    expect(buildExportFilename("   .xlsx", "xlsx", stamp)).toBe("questionnaire-answers-20260903.xlsx");
    const long = buildExportFilename(`${"x".repeat(300)}.xlsx`, "xlsx", stamp);
    expect(long.length).toBeLessThanOrEqual(80 + "-answers-20260903.xlsx".length);
    expect(long.endsWith("-answers-20260903.xlsx")).toBe(true);
  });
});
