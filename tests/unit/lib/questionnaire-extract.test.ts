import { describe, expect, it } from "vitest";

import { extractQuestions } from "@/lib/files/questionnaire/extract";
import type { SheetInspection, WorkbookInspection } from "@/lib/files/questionnaire/types";

/**
 * Extraction is the confirm-time contract: whatever these tests pin down is
 * exactly what lands in confirm_questionnaire_mapping's p_questions payload —
 * coordinates, skip rules, and the whole-import failure codes.
 */

function sheet(overrides: Partial<SheetInspection> = {}): SheetInspection {
  return {
    name: "Sheet1",
    state: "visible",
    rowCount: 4,
    columnCount: 3,
    matrix: [
      ["Question", "Answer", "Notes"],
      ["Is data encrypted at rest?", "", ""],
      ["   ", "filled", ""],
      ["  Who   approves  access?  ", "", "note"],
    ],
    truncatedRows: false,
    truncatedColumns: false,
    mergedRanges: [],
    ...overrides,
  };
}

function inspection(sheets: SheetInspection[]): WorkbookInspection {
  return {
    format: "xlsx",
    parserVersion: "exceljs@4.4.0",
    sheets,
    warnings: [],
    csv: null,
  };
}

const baseMapping = {
  sheetName: "Sheet1",
  headerRowIndex: 0,
  questionColumn: 0,
  answerColumn: 1 as number | null,
  notesColumn: null as number | null,
};

describe("extractQuestions", () => {
  it("emits the EXACT confirm_questionnaire_mapping wire keys (snake_case jsonb contract)", () => {
    const result = extractQuestions(inspection([sheet()]), baseMapping);
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.code}`);
    }
    const first = result.questions[0];
    if (first === undefined) {
      throw new Error("expected at least one question");
    }
    expect(Object.keys(first).sort()).toEqual([
      "answer_cell",
      "category",
      "notes_cell",
      "question_cell",
      "question_normalized",
      "question_original",
      "row_number",
      "sheet_name",
    ]);
  });

  it("extracts question rows with 1-based coordinates and skips empty cells", () => {
    const result = extractQuestions(inspection([sheet()]), baseMapping);
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.code}`);
    }
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0]).toMatchObject({
      sheet_name: "Sheet1",
      row_number: 2,
      question_cell: "A2",
      answer_cell: "B2",
      notes_cell: null,
      question_original: "Is data encrypted at rest?",
      question_normalized: "Is data encrypted at rest?",
      category: "general",
    });
    expect(result.questions[1]).toMatchObject({
      row_number: 4,
      question_cell: "A4",
      question_original: "Who   approves  access?",
      question_normalized: "Who approves access?",
    });
  });

  it("treats headerRowIndex -1 as a headerless sheet (data starts at row 0)", () => {
    const result = extractQuestions(inspection([sheet()]), { ...baseMapping, headerRowIndex: -1 });
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.code}`);
    }
    // The "Question" header cell becomes data; the blank row still skips.
    expect(result.questions).toHaveLength(3);
    expect(result.questions[0]).toMatchObject({ row_number: 1, question_cell: "A1", question_original: "Question" });
  });

  it("maps notes coordinates only when a notes column is chosen", () => {
    const result = extractQuestions(inspection([sheet()]), { ...baseMapping, notesColumn: 2 });
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.code}`);
    }
    expect(result.questions[0]?.notes_cell).toBe("C2");
  });

  it("emits A1 refs for columns past Z", () => {
    const wide = sheet({
      columnCount: 28,
      matrix: [["Question", ...new Array<string>(27).fill("")]],
    });
    const result = extractQuestions(inspection([wide]), { ...baseMapping, headerRowIndex: -1, answerColumn: 27 });
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.code}`);
    }
    expect(result.questions[0]?.question_cell).toBe("A1");
    expect(result.questions[0]?.answer_cell).toBe("AB1");
  });

  it("finds the requested sheet among several", () => {
    const result = extractQuestions(
      inspection([sheet({ name: "Cover" }), sheet({ name: "Questions" })]),
      { ...baseMapping, sheetName: "Questions" },
    );
    expect(result.ok).toBe(true);
  });

  it("fails whole-import codes for missing sheets, forged coordinates, and empty results", () => {
    expect(extractQuestions(inspection([sheet()]), { ...baseMapping, sheetName: "Nope" })).toEqual({
      ok: false,
      code: "MAPPING_SHEET_MISSING",
    });
    expect(extractQuestions(inspection([sheet()]), { ...baseMapping, questionColumn: 3 })).toEqual({
      ok: false,
      code: "MAPPING_INPUT_INVALID",
    });
    expect(extractQuestions(inspection([sheet()]), { ...baseMapping, headerRowIndex: 4 })).toEqual({
      ok: false,
      code: "MAPPING_INPUT_INVALID",
    });
    expect(extractQuestions(inspection([sheet()]), { ...baseMapping, answerColumn: -1 })).toEqual({
      ok: false,
      code: "MAPPING_INPUT_INVALID",
    });
    const allBlank = sheet({ matrix: [["Question", "Answer"], ["", ""], ["", ""]] });
    expect(extractQuestions(inspection([allBlank]), baseMapping)).toEqual({
      ok: false,
      code: "MAPPING_NO_QUESTIONS",
    });
  });

  it("rejects imports over the 1000-question ceiling (the DB limit, whole import)", () => {
    const rows = [["Question"], ...Array.from({ length: 1001 }, (_, i) => [`Q${i + 1}`])];
    const big = sheet({ rowCount: rows.length, columnCount: 1, matrix: rows });
    expect(extractQuestions(inspection([big]), { ...baseMapping, answerColumn: null })).toEqual({
      ok: false,
      code: "MAPPING_TOO_MANY_QUESTIONS",
    });
  });

  it("accepts exactly 1000 questions at the ceiling", () => {
    const rows = [["Question"], ...Array.from({ length: 1000 }, (_, i) => [`Q${i + 1}`])];
    const big = sheet({ rowCount: rows.length, columnCount: 1, matrix: rows });
    const result = extractQuestions(inspection([big]), { ...baseMapping, answerColumn: null });
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.code}`);
    }
    expect(result.questions).toHaveLength(1000);
    expect(result.questions.at(-1)?.row_number).toBe(1001);
  });
});
