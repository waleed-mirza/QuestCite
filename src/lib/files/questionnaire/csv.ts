/**
 * RFC 4180 CSV parse/serialize with delimiter + BOM handling (plan §9: "for
 * .csv, perform equivalent column mapping and preserve delimiter/encoding
 * metadata where practical").
 *
 * Pure and client-safe (no ExcelJS, no server-only): the parser is used
 * server-side for import/export AND in unit tests; the delimiter constants
 * feed UI copy. Round-trip fidelity rule: serialize(parse(x)) must differ
 * from x ONLY in line endings (always \r\n per RFC 4180) — quoting is
 * re-added exactly where required.
 */

export const CSV_DELIMITERS = [",", ";", "\t", "|"] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

const QUOTE = '"';
const DEFAULT_SNIFF_SAMPLE_LINES = 20;

export type CsvEncoding = "utf-8" | "utf-16le" | "utf-16be";

/**
 * Detects a byte-order mark and the encoding it declares. No BOM → utf-8
 * (the practical v1 support envelope; documented in docs/questionnaires.md).
 */
export function detectCsvEncoding(bytes: Uint8Array): { encoding: CsvEncoding; bom: boolean } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: "utf-8", bom: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: "utf-16le", bom: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: "utf-16be", bom: true };
  }
  return { encoding: "utf-8", bom: false };
}

/** Decodes workbook bytes to text, stripping any BOM (detect + TextDecoder). */
export function decodeCsvText(bytes: Uint8Array): string {
  const { encoding } = detectCsvEncoding(bytes);
  // TextDecoder strips the BOM itself when the encoding matches it.
  const text = new TextDecoder(encoding).decode(bytes);
  return text.replace(/^﻿/, "");
}

/**
 * Picks the delimiter that occurs most often OUTSIDE quoted sections across a
 * sample of lines. Ties and empty input resolve to "," (RFC 4180 default).
 * Never used as truth by itself — the detected value is shown on the mapping
 * preview and stored in questionnaire_files.metadata.
 */
export function sniffDelimiter(text: string, sampleLines = DEFAULT_SNIFF_SAMPLE_LINES): CsvDelimiter {
  const sample = text.split(/\r\n|\r|\n/, sampleLines).join("\n");
  let best: CsvDelimiter = ",";
  let bestCount = 0;
  for (const delimiter of CSV_DELIMITERS) {
    const count = countOutsideQuotes(sample, delimiter);
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

function countOutsideQuotes(text: string, target: string): number {
  let count = 0;
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (character === QUOTE) {
      inQuotes = !inQuotes;
    } else if (!inQuotes && character === target) {
      count += 1;
    }
  }
  return count;
}

/**
 * Strict RFC 4180 parser: quoted fields ("" escape), embedded newlines and
 * delimiters inside quotes, \r\n | \n | \r row breaks. A trailing newline
 * does not produce an empty trailing row. Unterminated quotes are tolerated
 * by treating the rest of the file as the field (parser errors never crash
 * an import; the mapping preview is where a mangled file becomes visible).
 */
export function parseCsv(text: string, delimiter: CsvDelimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;

  const endField = (): void => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";

    if (inQuotes) {
      if (character === QUOTE) {
        if (text[index + 1] === QUOTE) {
          field += QUOTE;
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === QUOTE && field === "" && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      continue;
    }
    if (character === delimiter) {
      endField();
      continue;
    }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      endRow();
      continue;
    }
    fieldStarted = true;
    field += character;
  }

  // Final field/row when the file does not end with a line break; an entirely
  // empty trailing field after the last break must NOT add a row.
  if (field !== "" || row.length > 0) {
    if (field === "" && row.length === 0 && rows.length > 0) {
      return rows;
    }
    endRow();
  }
  return rows;
}

/**
 * Serializes rows back to CSV bytes. Fields are quoted only when they contain
 * the delimiter, a quote, a carriage return, or a newline (minimal-change
 * round trips); quotes inside fields are doubled. `bom` re-adds the UTF-8
 * BOM when the original had one.
 */
export function serializeCsv(rows: string[][], delimiter: CsvDelimiter, bom: boolean): Uint8Array {
  const needsQuote = (field: string): boolean =>
    field.includes(delimiter) || field.includes(QUOTE) || field.includes("\n") || field.includes("\r");

  const lines = rows.map((row) =>
    row
      .map((field) => (needsQuote(field) ? QUOTE + field.replaceAll(QUOTE, QUOTE + QUOTE) + QUOTE : field))
      .join(delimiter),
  );

  const text = lines.join("\r\n") + "\r\n";
  const bytes = new TextEncoder().encode(text);
  if (!bom) {
    return bytes;
  }
  const withBom = new Uint8Array(bytes.length + 3);
  withBom.set([0xef, 0xbb, 0xbf], 0);
  withBom.set(bytes, 3);
  return withBom;
}
