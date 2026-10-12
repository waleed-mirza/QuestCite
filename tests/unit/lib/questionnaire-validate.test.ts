import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateQuestionnaireFile } from "@/lib/files/questionnaire/validate";

const FIXTURE_DIR = path.resolve("tests/fixtures/questionnaires");
const readFixture = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(FIXTURE_DIR, name)));

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CSV_MIME = "text/csv";

describe("validateQuestionnaireFile — happy paths", () => {
  it("accepts a real .xlsx (magic, extension, MIME all agree) and pins the checksum", () => {
    const result = validateQuestionnaireFile(readFixture("single-sheet.xlsx"), "q.xlsx", XLSX_MIME);
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.code}`);
    }
    expect(result.format).toBe("xlsx");
    expect(result.mime).toBe(XLSX_MIME);
    expect(result.sanitizedFilename).toBe("q.xlsx");
    expect(result.byteSize).toBeGreaterThan(0);
    expect(result.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts a UTF-8 .csv", () => {
    const result = validateQuestionnaireFile(readFixture("questions.csv"), "questions.csv", CSV_MIME);
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.code}`);
    }
    expect(result.format).toBe("csv");
    expect(result.mime).toBe(CSV_MIME);
  });

  it("accepts a UTF-16LE BOM csv — the parser supports BOM-declared encodings", () => {
    const text = "Question,Answer\nOne?,Yes\n";
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      bytes[2 + i * 2] = code & 0xff;
      bytes[3 + i * 2] = code >> 8;
    }
    const result = validateQuestionnaireFile(bytes, "q.csv", CSV_MIME);
    expect(result.ok).toBe(true);
  });
});

describe("validateQuestionnaireFile — the gate", () => {
  it("rejects empty and oversized files before anything else", () => {
    expect(validateQuestionnaireFile(new Uint8Array(0), "q.xlsx", XLSX_MIME)).toEqual({
      ok: false,
      code: "QUESTIONNAIRE_EMPTY",
    });
    expect(
      validateQuestionnaireFile(new Uint8Array(10 * 1024 * 1024 + 1), "q.xlsx", XLSX_MIME),
    ).toEqual({ ok: false, code: "QUESTIONNAIRE_TOO_LARGE" });
  });

  it("rejects disallowed extensions and MIME types", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    expect(validateQuestionnaireFile(bytes, "q.pdf", "application/pdf")).toEqual({
      ok: false,
      code: "QUESTIONNAIRE_TYPE_UNSUPPORTED",
    });
    expect(validateQuestionnaireFile(readFixture("questions.csv"), "q.csv", "application/zip")).toEqual({
      ok: false,
      code: "QUESTIONNAIRE_TYPE_UNSUPPORTED",
    });
  });

  it("rejects content that disagrees with the extension in BOTH directions", () => {
    // .xlsx name, text bytes — no ZIP magic.
    expect(validateQuestionnaireFile(readFixture("questions.csv"), "fake.xlsx", XLSX_MIME)).toEqual({
      ok: false,
      code: "EXTENSION_MISMATCH",
    });
    // .csv name, ZIP bytes — a renamed workbook.
    expect(validateQuestionnaireFile(readFixture("single-sheet.xlsx"), "fake.csv", CSV_MIME)).toEqual({
      ok: false,
      code: "EXTENSION_MISMATCH",
    });
  });

  it("rejects CSV payload that is not text in a supported encoding", () => {
    // Latin-1 bytes that are invalid UTF-8, with no BOM to rescue them.
    const bytes = new Uint8Array([0x51, 0x3f, 0xe9, 0x0a]); // "Q?\xe9\n"
    expect(validateQuestionnaireFile(bytes, "q.csv", CSV_MIME)).toEqual({
      ok: false,
      code: "ENCODING_UNSUPPORTED",
    });
    // A NUL byte means binary masquerading as CSV.
    const nul = new Uint8Array([0x51, 0x00, 0x0a]);
    expect(validateQuestionnaireFile(nul, "q.csv", CSV_MIME)).toEqual({
      ok: false,
      code: "EXTENSION_MISMATCH",
    });
  });

  it("rejects a declared MIME that contradicts the extension", () => {
    expect(
      validateQuestionnaireFile(readFixture("questions.csv"), "q.csv", XLSX_MIME),
    ).toEqual({ ok: false, code: "EXTENSION_MISMATCH" });
  });

  it("sanitizes hostile filenames to safe single segments", () => {
    const result = validateQuestionnaireFile(readFixture("questions.csv"), "..\\..\\evil name.xlsx.csv", CSV_MIME);
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.code}`);
    }
    expect(result.sanitizedFilename).toBe("evil name.xlsx.csv");
  });

  it("rejects filenames that sanitize to nothing useful", () => {
    // "..." strips to nothing → falls back to the placeholder name → invalid.
    expect(validateQuestionnaireFile(readFixture("questions.csv"), "...", CSV_MIME)).toEqual({
      ok: false,
      code: "FILENAME_INVALID",
    });
  });
});
