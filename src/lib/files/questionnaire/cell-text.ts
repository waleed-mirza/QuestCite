import type { CellValue } from "exceljs";

/**
 * Renders any exceljs CellValue to display text (shared by inspection and
 * export verification).
 *
 * Client-safe: the exceljs import is TYPE-ONLY (erased at runtime), so this
 * module carries no parser code into a client bundle. Formula cells render
 * their CACHED result (never the formula string — a formula is not question
 * content); uncached formulas and error cells render empty so mapping sees
 * what a reader would see.
 */
export function cellTextOf(value: CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("");
    }
    if ("result" in value) {
      // CellFormulaValue | CellSharedFormulaValue — render the cached result.
      return cellTextOf(value.result ?? null);
    }
    if ("text" in value) {
      // CellHyperlinkValue — the display text, not the URL.
      return typeof value.text === "string" ? value.text : String(value.text ?? "");
    }
    if ("error" in value) {
      return "";
    }
  }
  return "";
}
