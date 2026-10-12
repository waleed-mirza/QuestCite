import "server-only";

import ExcelJS from "exceljs";
import type { CellValue, Worksheet } from "exceljs";

import { cellTextOf } from "./cell-text";
import { decodeCsvText, parseCsv, sniffDelimiter } from "./csv";
import { scanWorkbookZip } from "./zip-safety";
import {
  INSPECT_MAX_CELL_CHARS,
  INSPECT_MAX_COLUMNS,
  INSPECT_MAX_ROWS,
  type SheetInspection,
  type WorkbookInspectResult,
  type WorkbookWarning,
} from "./types";

/**
 * Workbook inspection (plan §9 questionnaire import steps 2–3): read workbook
 * metadata and candidate sheets, render a capped preview matrix for the
 * mapping screen, and collect UNSUPPORTED-FEATURE WARNINGS (merged cells,
 * formulas, images, multiple sheets) as safe constant codes.
 *
 * Server-only: ExcelJS must never reach a client bundle (rule 9). Inspection
 * NEVER decides the mapping — it only feeds the user-controlled preview.
 */

// Bump alongside the exceljs dependency; stored on questionnaire_files.
const PARSER_VERSION_XLSX = "exceljs@4.4.0";
const PARSER_VERSION_CSV = "csv@1";

// Re-exported for existing server-side importers; the definitions live in
// types.ts so client-safe modules can mirror the caps without importing this
// server-only module.
export { INSPECT_MAX_CELL_CHARS, INSPECT_MAX_COLUMNS, INSPECT_MAX_ROWS };

export async function inspectWorkbook(
  bytes: Uint8Array,
  format: "xlsx" | "csv",
): Promise<WorkbookInspectResult> {
  if (format === "csv") {
    return inspectCsv(bytes);
  }
  return inspectXlsx(bytes);
}

async function inspectXlsx(bytes: Uint8Array): Promise<WorkbookInspectResult> {
  // Macro/encrypted packages are rejected BEFORE any parse attempt so a
  // renamed .xlsm can never reach the parser (plan §9 limits).
  const safety = scanWorkbookZip(bytes);
  if (!safety.ok) {
    return { ok: false, code: safety.code };
  }

  let workbook: ExcelJS.Workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(toExcelBuffer(bytes));
  } catch {
    // Never log the underlying parser error — it can quote cell content.
    return { ok: false, code: "WORKBOOK_PARSE_FAILED" };
  }

  if (workbook.worksheets.length === 0) {
    return { ok: false, code: "WORKBOOK_EMPTY" };
  }

  const warnings: WorkbookWarning[] = [];
  if (workbook.worksheets.length > 1) {
    warnings.push({ code: "MULTIPLE_SHEETS", sheetName: null });
  }

  const sheets: SheetInspection[] = workbook.worksheets.map((sheet) => {
    const inspection = inspectSheet(sheet);
    for (const code of inspection.warnings) {
      warnings.push({ code, sheetName: sheet.name });
    }
    return inspection.sheet;
  });

  return {
    ok: true,
    value: {
      format: "xlsx",
      parserVersion: PARSER_VERSION_XLSX,
      sheets,
      warnings,
      csv: null,
    },
  };
}

function inspectSheet(sheet: Worksheet): { sheet: SheetInspection; warnings: WorkbookWarning["code"][] } {
  const warnings: WorkbookWarning["code"][] = [];

  const rowLimit = Math.min(sheet.rowCount, INSPECT_MAX_ROWS);
  const columnLimit = Math.min(sheet.columnCount, INSPECT_MAX_COLUMNS);
  const matrix: string[][] = [];
  let lastContentRow = 0;
  let lastContentColumn = 0;
  let largeCell = false;
  let formulaCount = 0;

  for (let row = 1; row <= rowLimit; row += 1) {
    const sheetRow = sheet.getRow(row);
    const rendered: string[] = [];
    for (let column = 1; column <= columnLimit; column += 1) {
      const value: CellValue = sheetRow.getCell(column).value;
      const text = cellTextOf(value);
      if (
        value !== null && value !== undefined && typeof value === "object"
        && ("formula" in value || "sharedFormula" in value)
      ) {
        formulaCount += 1;
      }
      if (text !== "") {
        lastContentRow = Math.max(lastContentRow, row);
        lastContentColumn = Math.max(lastContentColumn, column);
      }
      if (text.length > INSPECT_MAX_CELL_CHARS) {
        largeCell = true;
        rendered.push(text.slice(0, INSPECT_MAX_CELL_CHARS));
        continue;
      }
      rendered.push(text);
    }
    matrix.push(rendered);
  }

  // Report the content bounding box, not the grid ExcelJS allocated.
  const trimmed = matrix.slice(0, lastContentRow).map((row) => row.slice(0, lastContentColumn));

  const mergedRanges = (sheet.model?.merges ?? []).map((range) => String(range));
  if (mergedRanges.length > 0) {
    warnings.push("MERGED_CELLS");
  }
  if (formulaCount > 0) {
    warnings.push("FORMULAS_PRESENT");
  }
  if (sheet.getImages().length > 0) {
    warnings.push("IMAGES_PRESENT");
  }
  if (sheet.rowCount > INSPECT_MAX_ROWS) {
    warnings.push("TRUNCATED_ROWS");
  }
  if (sheet.columnCount > INSPECT_MAX_COLUMNS) {
    warnings.push("TRUNCATED_COLUMNS");
  }
  if (largeCell) {
    warnings.push("LARGE_CELLS");
  }

  return {
    sheet: {
      name: sheet.name,
      state: sheet.state ?? "visible",
      rowCount: trimmed.length,
      columnCount: lastContentColumn,
      matrix: trimmed,
      truncatedRows: sheet.rowCount > INSPECT_MAX_ROWS,
      truncatedColumns: sheet.columnCount > INSPECT_MAX_COLUMNS,
      mergedRanges,
    },
    warnings,
  };
}

async function inspectCsv(bytes: Uint8Array): Promise<WorkbookInspectResult> {
  const { bom, encoding } = detectEncoding(bytes);
  const text = decodeCsvText(bytes);
  if (text.trim() === "") {
    return { ok: false, code: "WORKBOOK_EMPTY" };
  }
  const delimiter = sniffDelimiter(text);
  const parsed = parseCsv(text, delimiter);

  const warnings: WorkbookWarning[] = [];
  const rowLimit = Math.min(parsed.length, INSPECT_MAX_ROWS);
  let lastContentRow = 0;
  let lastContentColumn = 0;
  let largeCell = false;
  const matrix: string[][] = [];

  for (let row = 0; row < rowLimit; row += 1) {
    const source = parsed[row] ?? [];
    const rendered: string[] = [];
    for (let column = 0; column < source.length && column < INSPECT_MAX_COLUMNS; column += 1) {
      const value = source[column] ?? "";
      if (value !== "") {
        lastContentRow = Math.max(lastContentRow, row + 1);
        lastContentColumn = Math.max(lastContentColumn, column + 1);
      }
      if (value.length > INSPECT_MAX_CELL_CHARS) {
        largeCell = true;
        rendered.push(value.slice(0, INSPECT_MAX_CELL_CHARS));
        continue;
      }
      rendered.push(value);
    }
    matrix.push(rendered);
  }

  if (parsed.length > INSPECT_MAX_ROWS) {
    warnings.push({ code: "TRUNCATED_ROWS", sheetName: null });
  }
  if (largeCell) {
    warnings.push({ code: "LARGE_CELLS", sheetName: null });
  }

  return {
    ok: true,
    value: {
      format: "csv",
      parserVersion: PARSER_VERSION_CSV,
      sheets: [
        {
          name: "CSV",
          state: "visible",
          rowCount: lastContentRow,
          columnCount: lastContentColumn,
          matrix: matrix.slice(0, lastContentRow).map((row) => row.slice(0, lastContentColumn)),
          truncatedRows: parsed.length > INSPECT_MAX_ROWS,
          truncatedColumns: (parsed[0]?.length ?? 0) > INSPECT_MAX_COLUMNS,
          mergedRanges: [],
        },
      ],
      warnings,
      csv: { delimiter, bom, encoding },
    },
  };
}

function detectEncoding(bytes: Uint8Array): { bom: boolean; encoding: string } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { bom: true, encoding: "utf-8" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { bom: true, encoding: "utf-16le" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { bom: true, encoding: "utf-16be" };
  }
  return { bom: false, encoding: "utf-8" };
}

/**
 * exceljs's bundled types augment the GLOBAL `Buffer` interface with
 * ES2024 ArrayBuffer members, so Node's `Buffer` no longer structurally
 * matches the parser's declared `load(buffer: Buffer)` parameter (a known
 * exceljs typing defect — at runtime a Node Buffer is exactly what it
 * consumes, byte-for-byte). This helper holds the ONE narrow, reviewed
 * assertion that adapts the type; the value is passed untouched.
 */
function toExcelBuffer(bytes: Uint8Array): Parameters<typeof ExcelJS.Workbook.prototype.xlsx.load>[0] {
  return Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ) as unknown as Parameters<typeof ExcelJS.Workbook.prototype.xlsx.load>[0];
}
