import { MAX_QUESTIONS_PER_IMPORT } from "@/config/questionnaires";
import { MAX_SHEET_COLUMNS, numberToColumnName } from "./cellref";
import type { WorkbookInspection } from "./types";

/**
 * Mapping → question rows (plan §9 step 4→5). PURE and client-safe: a pure
 * function of the inspection matrix and the USER-CONFIRMED mapping — never of
 * detection output (detect.ts only prefills the preview; this module runs at
 * confirm time on the server, against the stored original re-inspected from
 * storage, so what gets imported is exactly what the user saw and confirmed).
 *
 * Question text comes from the mapped column; empty cells are not questions
 * and are skipped. The 1000-question import ceiling mirrors
 * private.questionnaire_limits; exceeding it fails the WHOLE import (the
 * confirm RPC is transactional — no partial questionnaires, ever).
 */

export type QuestionColumnMapping = {
  sheetName: string;
  /** 0-based header row; -1 = headerless sheet, data starts at row 0. */
  headerRowIndex: number;
  /** 0-based column indexes into the inspection matrix. */
  questionColumn: number;
  answerColumn: number | null;
  notesColumn: number | null;
};

/**
 * Wire format for confirm_questionnaire_mapping's p_questions elements —
 * SNAKE_CASE by design: these objects are serialized to jsonb and validated
 * field-by-field by the RPC (0010), so the shape IS the contract. No
 * transformation layer in between that could drift.
 */
export type MappedQuestion = {
  sheet_name: string;
  row_number: number;
  question_cell: string;
  answer_cell: string | null;
  notes_cell: string | null;
  question_original: string;
  question_normalized: string;
  category: string;
};

export type QuestionExtractFailureCode =
  | "MAPPING_INPUT_INVALID"
  | "MAPPING_SHEET_MISSING"
  | "MAPPING_NO_QUESTIONS"
  | "MAPPING_TOO_MANY_QUESTIONS";

export type QuestionExtractResult =
  | { ok: true; questions: MappedQuestion[] }
  | { ok: false; code: QuestionExtractFailureCode };

export function extractQuestions(
  inspection: WorkbookInspection,
  mapping: QuestionColumnMapping,
): QuestionExtractResult {
  const sheet = inspection.sheets.find((candidate) => candidate.name === mapping.sheetName);
  if (sheet === undefined) {
    return { ok: false, code: "MAPPING_SHEET_MISSING" };
  }

  // Coordinates must point inside the inspected matrix — the mapping UI only
  // offers real columns, so an out-of-range value here is forged input.
  if (
    mapping.headerRowIndex < -1
    || mapping.headerRowIndex >= sheet.rowCount
    || mapping.questionColumn < 0
    || mapping.questionColumn >= sheet.columnCount
    || mapping.questionColumn + 1 > MAX_SHEET_COLUMNS
    || (mapping.answerColumn !== null
      && (mapping.answerColumn < 0 || mapping.answerColumn >= sheet.columnCount))
    || (mapping.notesColumn !== null
      && (mapping.notesColumn < 0 || mapping.notesColumn >= sheet.columnCount))
  ) {
    return { ok: false, code: "MAPPING_INPUT_INVALID" };
  }

  const firstDataRow = mapping.headerRowIndex + 1;
  const questions: MappedQuestion[] = [];

  for (let row = firstDataRow; row < sheet.rowCount; row += 1) {
    // matrix rows exist for every inspected row; columns may be short.
    const original = (sheet.matrix[row]?.[mapping.questionColumn] ?? "").trim();
    if (original === "") {
      continue;
    }
    questions.push({
      sheet_name: sheet.name,
      row_number: row + 1,
      question_cell: cellRef(mapping.questionColumn, row),
      answer_cell: mapping.answerColumn === null ? null : cellRef(mapping.answerColumn, row),
      notes_cell: mapping.notesColumn === null ? null : cellRef(mapping.notesColumn, row),
      question_original: original,
      question_normalized: normalize(original),
      category: "general",
    });
  }

  if (questions.length === 0) {
    return { ok: false, code: "MAPPING_NO_QUESTIONS" };
  }
  if (questions.length > MAX_QUESTIONS_PER_IMPORT) {
    return { ok: false, code: "MAPPING_TOO_MANY_QUESTIONS" };
  }
  return { ok: true, questions };
}

function cellRef(column: number, row: number): string {
  return numberToColumnName(column + 1) + String(row + 1);
}

/** Search text: trimmed with internal whitespace runs collapsed. */
function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
