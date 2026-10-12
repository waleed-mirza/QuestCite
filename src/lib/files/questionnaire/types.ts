/**
 * Shared result shapes for workbook inspection/mapping (plan §9).
 *
 * Client-safe by construction: structural types only — no exceljs import, no
 * server-only module. The mapping preview renders these directly; warnings
 * are SAFE CONSTANT CODES (never workbook content), mapped to copy in the UI.
 */

export type WorkbookFormat = "xlsx" | "csv";

/**
 * Inspection caps (shared client-safe so the mapping UI and its validation
 * schemas can mirror the parser without touching the server-only module).
 */
export const INSPECT_MAX_ROWS = 2000;
export const INSPECT_MAX_COLUMNS = 64;
/** Question text ceilings mirror private.questionnaire_limits (4000). */
export const INSPECT_MAX_CELL_CHARS = 4000;

export type WorkbookWarningCode =
  | "MERGED_CELLS"
  | "FORMULAS_PRESENT"
  | "IMAGES_PRESENT"
  | "MULTIPLE_SHEETS"
  | "TRUNCATED_ROWS"
  | "TRUNCATED_COLUMNS"
  | "LARGE_CELLS";

export type WorkbookWarning = {
  code: WorkbookWarningCode;
  sheetName: string | null;
};

export type SheetState = "visible" | "hidden" | "veryHidden";

export type SheetInspection = {
  name: string;
  state: SheetState;
  /** Content rows/cols actually present, after the inspection caps. */
  rowCount: number;
  columnCount: number;
  /** Rendered cell text, 0-based [row][column], capped and truncated. */
  matrix: string[][];
  truncatedRows: boolean;
  truncatedColumns: boolean;
  /** Merged ranges as A1-style strings ("A1:D1") — a fidelity heads-up. */
  mergedRanges: string[];
};

export type CsvInspectionMetadata = {
  delimiter: string;
  bom: boolean;
  encoding: string;
};

export type WorkbookInspection = {
  format: WorkbookFormat;
  parserVersion: string;
  sheets: SheetInspection[];
  warnings: WorkbookWarning[];
  csv: CsvInspectionMetadata | null;
};

/**
 * Safe rejection codes for inspect/export failures. None of them carry
 * parser messages, paths, or content (plan §16 log hygiene).
 */
export type WorkbookFailureCode =
  | "WORKBOOK_MACROS_UNSUPPORTED"
  | "WORKBOOK_ENCRYPTED"
  | "WORKBOOK_PARSE_FAILED"
  | "WORKBOOK_EMPTY"
  | "EXPORT_MAPPING_INVALID"
  | "EXPORT_SHEET_MISSING"
  | "EXPORT_SUMMARY_UNSUPPORTED"
  | "EXPORT_VERIFY_FAILED";

export type WorkbookInspectResult =
  | { ok: true; value: WorkbookInspection }
  | { ok: false; code: WorkbookFailureCode };
