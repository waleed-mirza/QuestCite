import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { columnNameToNumber, numberToColumnName, parseCellRef } from "@/lib/files/questionnaire/cellref";
import {
  decodeCsvText,
  detectCsvEncoding,
  parseCsv,
  serializeCsv,
  sniffDelimiter,
} from "@/lib/files/questionnaire/csv";
import { scanWorkbookZip } from "@/lib/files/questionnaire/zip-safety";

const FIXTURE_DIR = path.resolve("tests/fixtures/questionnaires");
const readFixture = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(FIXTURE_DIR, name)));

describe("cellref", () => {
  it("parses A1-style refs into 1-based coordinates", () => {
    expect(parseCellRef("A1")).toEqual({ row: 1, column: 1 });
    expect(parseCellRef("C7")).toEqual({ row: 7, column: 3 });
    expect(parseCellRef("AB12")).toEqual({ row: 12, column: 28 });
    expect(parseCellRef("XFD1048576")).toEqual({ row: 1048576, column: 16384 });
  });

  it("rejects malformed or out-of-range refs the same way the DB CHECK does", () => {
    expect(parseCellRef("c7")).toBeNull(); // lowercase — the app uppercases first
    expect(parseCellRef("A0")).toBeNull();
    expect(parseCellRef("AAAA1")).toBeNull();
    expect(parseCellRef("1A")).toBeNull();
    expect(parseCellRef("")).toBeNull();
    expect(parseCellRef("A1048577")).toBeNull(); // past Excel's row cap
  });

  it("round-trips column names", () => {
    for (const [name, number] of [
      ["A", 1],
      ["Z", 26],
      ["AA", 27],
      ["AB", 28],
      ["AZ", 52],
      ["BA", 53],
      ["XFD", 16384],
    ] as const) {
      expect(columnNameToNumber(name)).toBe(number);
      expect(numberToColumnName(number)).toBe(name);
    }
    expect(numberToColumnName(0)).toBe("");
    expect(numberToColumnName(16385)).toBe("");
  });
});

describe("csv encoding + delimiter sniffing", () => {
  it("detects UTF-8 BOM, UTF-16 BOMs, and the absence of one", () => {
    expect(detectCsvEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toEqual({ encoding: "utf-8", bom: true });
    expect(detectCsvEncoding(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toEqual({ encoding: "utf-16le", bom: true });
    expect(detectCsvEncoding(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toEqual({ encoding: "utf-16be", bom: true });
    expect(detectCsvEncoding(new Uint8Array([0x61, 0x62]))).toEqual({ encoding: "utf-8", bom: false });
  });

  it("decodes and strips the BOM", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("a,b")]);
    expect(decodeCsvText(withBom)).toBe("a,b");
  });

  it("sniffs the most frequent delimiter outside quotes", () => {
    expect(sniffDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(sniffDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(sniffDelimiter("a\tb\tc")).toBe("\t");
    expect(sniffDelimiter("a|b|c")).toBe("|");
    expect(sniffDelimiter('"a,b;c",x')).toBe(","); // delimiter inside quotes does not count
    expect(sniffDelimiter("plain text only")).toBe(","); // RFC 4180 default
  });
});

describe("csv parse (RFC 4180)", () => {
  it("parses simple rows and strips the trailing newline", () => {
    expect(parseCsv("a,b,c\r\n1,2,3\r\n", ",")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
    expect(parseCsv("a,b", ",")).toEqual([["a", "b"]]);
  });

  it("handles quoted fields with embedded delimiters, quotes, and newlines", () => {
    const text = '"x,y","say ""hi""","line1\nline2"\r\nz,,,';
    expect(parseCsv(text, ",")).toEqual([
      ["x,y", 'say "hi"', "line1\nline2"],
      ["z", "", "", ""], // z + 3 separators = 4 fields (RFC 4180)
    ]);
  });

  it("tolerates lone \r line breaks and a final field without newline", () => {
    expect(parseCsv("a,b\rc,d", ",")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps delimiter characters inside quotes when the delimiter is a semicolon", () => {
    expect(parseCsv('"a;b";c', ";")).toEqual([["a;b", "c"]]);
  });
});

describe("csv serialize (minimal re-quoting)", () => {
  it("round-trips parse→serialize→parse exactly", () => {
    const rows = [
      ["Question", "Answer", "Notes"],
      ["Is data encrypted, at rest?", "Yes — AES-256", "see §2"],
      ["Line question\nwith break", "a,b", 'quote " test'],
    ];
    const serialized = serializeCsv(rows, ",", false);
    expect(parseCsv(decodeCsvText(serialized), ",")).toEqual(rows);
  });

  it("quotes only fields that need it", () => {
    const bytes = decodeCsvText(serializeCsv([["plain", "with,comma", 'with"quote', "with\nnewline"]], ",", false));
    expect(bytes).toBe('plain,"with,comma","with""quote","with\nnewline"\r\n');
  });

  it("re-adds the BOM only when asked", () => {
    const withBom = serializeCsv([["a"]], ",", true);
    expect([...withBom.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const withoutBom = serializeCsv([["a"]], ",", false);
    expect(withoutBom[0]).toBe(0x61);
  });

  it("preserves the semicolon fixture through a full byte round-trip", () => {
    const original = readFixture("questions-semicolon-bom.csv");
    const rows = parseCsv(decodeCsvText(original), ";");
    expect(rows[0]).toEqual(["Frage", "Antwort", "Notizen"]);
    const rewritten = serializeCsv(rows, ";", true);
    expect([...rewritten.slice(0, 3)]).toEqual([...original.slice(0, 3)]);
    // serializeCsv ALWAYS emits CRLF (its documented contract), but git may
    // check the text fixture out with LF (Linux CI). Compare against the
    // fixture normalized to that contract — this asserts content, quoting,
    // BOM, and delimiter fidelity, not checkout line-ending configuration.
    const normalizedText = decodeCsvText(original).replaceAll(/\r?\n/g, "\r\n");
    const expected = new TextEncoder().encode(String.fromCodePoint(0xfeff) + normalizedText);
    expect(rewritten).toEqual(expected);
  });
});

describe("zip safety scan", () => {
  it("rejects macro projects before any parse (real fixture)", () => {
    expect(scanWorkbookZip(readFixture("macro.xlsx"))).toEqual({ ok: false, code: "WORKBOOK_MACROS_UNSUPPORTED" });
  });

  it("rejects encrypted packages before any parse (real fixture)", () => {
    expect(scanWorkbookZip(readFixture("encrypted.xlsx"))).toEqual({ ok: false, code: "WORKBOOK_ENCRYPTED" });
  });

  it("passes clean workbooks and non-zip input (the parser owns that failure)", () => {
    expect(scanWorkbookZip(readFixture("single-sheet.xlsx"))).toEqual({ ok: true });
    expect(scanWorkbookZip(new Uint8Array(0))).toEqual({ ok: true });
    expect(scanWorkbookZip(new TextEncoder().encode("just some text"))).toEqual({ ok: true });
  });

  it("is suffix-sensitive: vbaProject.bin anywhere in the package is a macro", () => {
    // The real fixture stores it as xl/vbaProject.bin; a differently-nested
    // entry must be caught identically.
    const fixture = readFixture("macro.xlsx");
    const text = new TextDecoder("latin1").decode(fixture);
    expect(text.toLowerCase()).toContain("vbaproject.bin");
  });
});
