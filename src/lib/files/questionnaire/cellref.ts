/**
 * A1-style cell reference utilities (plan §9: persist source sheet/row/cell
 * coordinates for round-trip export).
 *
 * Pure and client-safe: no server-only imports, no ExcelJS. The DB CHECK
 * constraints mirror the same regex — this module gives instant, typed
 * feedback and coordinate math on top.
 */

const CELL_REF_RE = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;
const COLUMN_NAME_RE = /^[A-Z]{1,3}$/;

/** Excel's column limit per sheet; keeps coordinates inside real workbooks. */
export const MAX_SHEET_ROWS = 1048576;
export const MAX_SHEET_COLUMNS = 16384;

export type CellCoordinates = { row: number; column: number };

/**
 * Parses `"C7"` into 1-based `{ row: 7, column: 3 }`. Returns null for
 * anything outside the DB's own cell-ref shape (callers treat that as invalid
 * mapping input, matching the `MAPPING_INPUT_INVALID` path).
 */
export function parseCellRef(ref: string): CellCoordinates | null {
  const match = CELL_REF_RE.exec(ref);
  if (match === null) {
    return null;
  }
  const column = columnNameToNumber(match[1] ?? "");
  const row = Number.parseInt(match[2] ?? "", 10);
  if (column > MAX_SHEET_COLUMNS || row > MAX_SHEET_ROWS) {
    return null;
  }
  return { row, column };
}

/** `"AB"` → 28 (A=1, Z=26, AA=27, …). Case-sensitive upper-case input. */
export function columnNameToNumber(name: string): number {
  if (!COLUMN_NAME_RE.test(name)) {
    return 0;
  }
  let value = 0;
  for (const character of name) {
    value = value * 26 + (character.charCodeAt(0) - 64);
  }
  return value;
}

/** 28 → `"AB"`. Inverse of columnNameToNumber for display/back-ref needs. */
export function numberToColumnName(column: number): string {
  if (!Number.isInteger(column) || column < 1 || column > MAX_SHEET_COLUMNS) {
    return "";
  }
  let remaining = column;
  let name = "";
  while (remaining > 0) {
    const offset = (remaining - 1) % 26;
    name = String.fromCharCode(65 + offset) + name;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return name;
}
