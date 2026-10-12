import "server-only";

import ExcelJS from "exceljs";
import type { Worksheet } from "exceljs";

import { parseCellRef } from "./cellref";
import { decodeCsvText, parseCsv, serializeCsv, type CsvDelimiter } from "./csv";
import { cellTextOf } from "./cell-text";
import { scanWorkbookZip } from "./zip-safety";
import type { WorkbookFailureCode } from "./types";

/**
 * Round-trip export engine (plan §9 Export): load the UNTOUCHED original,
 * write ONLY into mapped answer cells, never mutate the source bytes, and
 * refuse when the mapping no longer matches what the original holds.
 *
 * Guarantees (each enforced here and re-proven by the round-trip tests):
 * - The original buffer is read-only input; exports are new byte arrays.
 * - Only answer cells are written; every other cell, style, merge, formula,
 *   and sheet-order decision stays with ExcelJS's re-serializer, which the
 *   fixture matrix tests pin down.
 * - Every export is REOPENED before being returned (EXPORT_VERIFY_FAILED
 *   otherwise) — a workbook that cannot be read back is never shipped.
 * - CSV exports preserve the original delimiter and BOM state.
 */

export type ExportAnswerLocation = {
  sheetName: string;
  rowNumber: number;
  /** A1-style answer cell (the mapped target). */
  answerCell: string;
  text: string;
};

export type ExportCellExpectation = {
  sheetName: string;
  rowNumber: number;
  /** A1-style question cell whose content must still match the import. */
  questionCell: string;
  expectedText: string;
};

export type ExportSummaryRow = {
  question: string;
  answer: string;
  status: string;
  category: string;
};

export type WorkbookExportInput = {
  original: Uint8Array;
  format: "xlsx" | "csv";
  answers: ExportAnswerLocation[];
  /** Required when format is "csv" — from questionnaire_files.metadata. */
  csv?: { delimiter: string; bom: boolean };
  /**
   * Opt-in generated summary sheet (plan §9: only when the user enables it).
   * xlsx only — a CSV has no sheet to append to, and injecting summary rows
   * into customer data would corrupt its shape.
   */
  summary?: { sheetName: string; rows: ExportSummaryRow[] };
};

export type WorkbookExportResult =
  | { ok: true; value: { bytes: Uint8Array; written: number } }
  | { ok: false; code: WorkbookFailureCode };

/**
 * Pre-write integrity check (plan §9: "Refuse export when mappings no longer
 * match expected cells"): every question cell must still contain the text
 * that was imported at those coordinates.
 */
export async function verifyOriginalCells(input: {
  original: Uint8Array;
  format: "xlsx" | "csv";
  expectations: ExportCellExpectation[];
  csv?: { delimiter: string; bom: boolean };
}): Promise<{ ok: true } | { ok: false; code: WorkbookFailureCode }> {
  const { original, format, expectations, csv } = input;
  if (expectations.length === 0) {
    return { ok: false, code: "EXPORT_MAPPING_INVALID" };
  }
  if (format === "csv") {
    if (csv === undefined) {
      return { ok: false, code: "EXPORT_MAPPING_INVALID" };
    }
    const rows = parseCsv(decodeCsvText(original), csv.delimiter as CsvDelimiter);
    for (const expectation of expectations) {
      const actual = csvCellAt(rows, expectation.rowNumber, expectation.questionCell);
      if (actual === null || normalize(actual) !== normalize(expectation.expectedText)) {
        return { ok: false, code: "EXPORT_MAPPING_INVALID" };
      }
    }
    return { ok: true };
  }

  const safety = scanWorkbookZip(original);
  if (!safety.ok) {
    return { ok: false, code: safety.code };
  }
  const loaded = await loadWorkbook(original);
  if (loaded === null) {
    return { ok: false, code: "WORKBOOK_PARSE_FAILED" };
  }
  for (const expectation of expectations) {
    const sheet = findSheet(loaded, expectation.sheetName);
    if (sheet === null) {
      return { ok: false, code: "EXPORT_SHEET_MISSING" };
    }
    const coordinates = parseCellRef(expectation.questionCell);
    if (coordinates === null || coordinates.row !== expectation.rowNumber) {
      return { ok: false, code: "EXPORT_MAPPING_INVALID" };
    }
    const actual = cellTextOf(sheet.getRow(coordinates.row).getCell(coordinates.column).value);
    if (normalize(actual) !== normalize(expectation.expectedText)) {
      return { ok: false, code: "EXPORT_MAPPING_INVALID" };
    }
  }
  return { ok: true };
}

/** Writes answers into a COPY of the original and verifies it reopens. */
export async function writeAnswersToWorkbook(input: WorkbookExportInput): Promise<WorkbookExportResult> {
  const { original, format, answers, csv, summary } = input;
  if (format === "csv") {
    if (summary !== undefined) {
      return { ok: false, code: "EXPORT_SUMMARY_UNSUPPORTED" };
    }
    return exportCsv(original, answers, csv);
  }

  const safety = scanWorkbookZip(original);
  if (!safety.ok) {
    return { ok: false, code: safety.code };
  }
  const workbook = await loadWorkbook(original);
  if (workbook === null) {
    return { ok: false, code: "WORKBOOK_PARSE_FAILED" };
  }

  for (const answer of answers) {
    const sheet = findSheet(workbook, answer.sheetName);
    if (sheet === null) {
      return { ok: false, code: "EXPORT_SHEET_MISSING" };
    }
    const coordinates = parseCellRef(answer.answerCell);
    if (coordinates === null || coordinates.row !== answer.rowNumber) {
      return { ok: false, code: "EXPORT_MAPPING_INVALID" };
    }
    sheet.getRow(coordinates.row).getCell(coordinates.column).value = answer.text;
  }

  // The opt-in summary sheet is APPENDED last; original sheets keep their
  // order, names, and content (the round-trip gate pins this).
  if (summary !== undefined) {
    const sheet = workbook.addWorksheet(summary.sheetName);
    sheet.addRow(["Question", "Answer", "Status", "Category"]);
    for (const row of summary.rows) {
      sheet.addRow([row.question, row.answer, row.status, row.category]);
    }
  }

  let written: Uint8Array;
  try {
    // ExcelJS.Buffer extends ArrayBuffer, so the Uint8Array view constructor
    // applies directly (no cast, no copy).
    written = new Uint8Array(await workbook.xlsx.writeBuffer());
  } catch {
    return { ok: false, code: "WORKBOOK_PARSE_FAILED" };
  }

  // Reopen-and-verify (plan §9): the exported workbook must read back with
  // every answer in place, or it is not shipped.
  const reopened = await loadWorkbook(written);
  if (reopened === null) {
    return { ok: false, code: "EXPORT_VERIFY_FAILED" };
  }
  for (const answer of answers) {
    const sheet = findSheet(reopened, answer.sheetName);
    const coordinates = parseCellRef(answer.answerCell);
    if (sheet === null || coordinates === null) {
      return { ok: false, code: "EXPORT_VERIFY_FAILED" };
    }
    const actual = cellTextOf(sheet.getRow(coordinates.row).getCell(coordinates.column).value);
    if (normalize(actual) !== normalize(answer.text)) {
      return { ok: false, code: "EXPORT_VERIFY_FAILED" };
    }
  }
  if (summary !== undefined) {
    const summarySheet = findSheet(reopened, summary.sheetName);
    if (
      summarySheet === null ||
      summarySheet.rowCount < summary.rows.length + 1 ||
      normalize(cellTextOf(summarySheet.getRow(1).getCell(1).value)) !== "Question"
    ) {
      return { ok: false, code: "EXPORT_VERIFY_FAILED" };
    }
  }

  return { ok: true, value: { bytes: written, written: answers.length } };
}

async function exportCsv(
  original: Uint8Array,
  answers: ExportAnswerLocation[],
  csv?: { delimiter: string; bom: boolean },
): Promise<WorkbookExportResult> {
  if (csv === undefined) {
    return { ok: false, code: "EXPORT_MAPPING_INVALID" };
  }
  const delimiter = csv.delimiter as CsvDelimiter;
  const rows = parseCsv(decodeCsvText(original), delimiter);

  for (const answer of answers) {
    const coordinates = parseCellRef(answer.answerCell);
    if (coordinates === null || coordinates.row !== answer.rowNumber) {
      return { ok: false, code: "EXPORT_MAPPING_INVALID" };
    }
    const rowIndex = answer.rowNumber - 1;
    if (rowIndex >= rows.length) {
      // The original has fewer rows than the mapping expects — refuse.
      return { ok: false, code: "EXPORT_MAPPING_INVALID" };
    }
    const row = rows[rowIndex];
    if (row === undefined) {
      return { ok: false, code: "EXPORT_MAPPING_INVALID" };
    }
    while (row.length < coordinates.column) {
      row.push("");
    }
    row[coordinates.column - 1] = answer.text;
  }

  const bytes = serializeCsv(rows, delimiter, csv.bom);

  // Reopen-and-verify: reparse and confirm every answer landed.
  const reopened = parseCsv(decodeCsvText(bytes), delimiter);
  for (const answer of answers) {
    const coordinates = parseCellRef(answer.answerCell);
    const actual = coordinates === null ? null : csvCellAt(reopened, answer.rowNumber, answer.answerCell);
    if (actual === null || normalize(actual) !== normalize(answer.text)) {
      return { ok: false, code: "EXPORT_VERIFY_FAILED" };
    }
  }

  return { ok: true, value: { bytes, written: answers.length } };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function loadWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook | null> {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(toExcelBuffer(bytes));
    return workbook;
  } catch {
    // Parser errors may quote content — never surfaced (plan §16).
    return null;
  }
}

function findSheet(workbook: ExcelJS.Workbook, name: string): Worksheet | null {
  return workbook.worksheets.find((sheet) => sheet.name === name) ?? null;
}

function csvCellAt(rows: string[][], rowNumber: number, cellRef: string): string | null {
  const coordinates = parseCellRef(cellRef);
  if (coordinates === null || coordinates.row !== rowNumber) {
    return null;
  }
  const row = rows[rowNumber - 1];
  if (row === undefined) {
    return null;
  }
  return row[coordinates.column - 1] ?? "";
}

function normalize(value: string): string {
  return value.trim();
}

/** See inspect.ts for the documented exceljs Buffer typing defect. */
function toExcelBuffer(bytes: Uint8Array): Parameters<typeof ExcelJS.Workbook.prototype.xlsx.load>[0] {
  return Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ) as unknown as Parameters<typeof ExcelJS.Workbook.prototype.xlsx.load>[0];
}
