import { readFileSync } from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { detectColumns } from "@/lib/files/questionnaire/detect";
import {
  verifyOriginalCells,
  writeAnswersToWorkbook,
  type ExportAnswerLocation,
} from "@/lib/files/questionnaire/export";
import { inspectWorkbook } from "@/lib/files/questionnaire/inspect";

/**
 * Week 4 GATE (plan §18): every supported workbook fixture imports AND
 * exports without corrupting the original structure. Import = inspect +
 * detect (the same glue the mapping UI runs); export = write answers into a
 * copy through the export engine; corruption check = reopen the export with
 * a fresh ExcelJS instance and pin cell values, sheet order, merges,
 * formulas, and representative styles against the untouched original.
 */

const FIXTURE_DIR = path.resolve("tests/fixtures/questionnaires");
const readFixture = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(FIXTURE_DIR, name)));

function loadRaw(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  return workbook.xlsx.load(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
}

/** The import glue: inspect, pick the sheet, detect columns. */
async function importFixture(name: string) {
  const inspection = await inspectWorkbook(readFixture(name), name.endsWith(".csv") ? "csv" : "xlsx");
  expect(inspection.ok).toBe(true);
  if (!inspection.ok) throw new Error("unreachable");
  return inspection.value;
}

/** Maps detected columns to answer locations (what the confirmed mapping produces). */
function answerLocations(
  matrix: string[][],
  questionColumn: number,
  answerColumn: number,
  sheetName: string,
  headerRowIndex: number,
  answersByText: Record<string, string>,
): ExportAnswerLocation[] {
  const locations: ExportAnswerLocation[] = [];
  for (let row = headerRowIndex + 1; row < matrix.length; row += 1) {
    const question = matrix[row]?.[questionColumn] ?? "";
    const answer = answersByText[question];
    if (question === "" || answer === undefined) continue;
    locations.push({
      sheetName,
      rowNumber: row + 1, // matrix is 0-based; sheets are 1-based
      answerCell: columnLetter(answerColumn) + String(row + 1),
      text: answer,
    });
  }
  return locations;
}

function columnLetter(zeroBased: number): string {
  let remaining = zeroBased + 1;
  let name = "";
  while (remaining > 0) {
    const offset = (remaining - 1) % 26;
    name = String.fromCharCode(65 + offset) + name;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return name;
}

describe("workbook inspection — fixture matrix", () => {
  it("reads a clean single sheet with header, questions, and no structural warnings", async () => {
    const inspection = await importFixture("single-sheet.xlsx");
    expect(inspection.sheets).toHaveLength(1);
    const sheet = inspection.sheets[0];
    expect(sheet?.name).toBe("Sheet1");
    expect(sheet?.matrix[0]?.slice(0, 3)).toEqual(["Question", "Answer", "Notes"]);
    // The F1/H10 sentinel cells are real content: the reported bounding box
    // is 10 rows × 8 columns, and the header row carries empty padding up to it.
    expect(sheet?.rowCount).toBe(10);
    expect(sheet?.columnCount).toBe(8);
    expect(inspection.warnings).toEqual([]);
    expect(inspection.csv).toBeNull();
    expect(inspection.parserVersion).toMatch(/^exceljs@\d/);
  });

  it("flags multiple sheets", async () => {
    const inspection = await importFixture("multi-sheet.xlsx");
    expect(inspection.sheets.map((sheet) => sheet.name)).toEqual(["Security", "Privacy"]);
    expect(inspection.warnings.some((warning) => warning.code === "MULTIPLE_SHEETS")).toBe(true);
    const privacy = inspection.sheets.find((sheet) => sheet.name === "Privacy");
    expect(privacy?.matrix[1]?.[0]).toContain("DPIA");
  });

  it("keeps blank rows as empty rows without dropping the questions after them", async () => {
    const inspection = await importFixture("blank-rows.xlsx");
    const sheet = inspection.sheets[0];
    expect(sheet?.rowCount).toBe(7);
    expect((sheet?.matrix[1] ?? [])[0]).toContain("encrypted at rest");
    expect((sheet?.matrix[6] ?? [])[0]).toContain("Where is production data hosted?");
    expect((sheet?.matrix[2] ?? []).every((cell) => cell === "")).toBe(true);
  });

  it("reports merged headings and lists the merged range", async () => {
    const inspection = await importFixture("merged-headings.xlsx");
    expect(inspection.warnings.some((warning) => warning.code === "MERGED_CELLS")).toBe(true);
    const sheet = inspection.sheets[0];
    expect(sheet?.mergedRanges).toContain("A1:C1");
    // The real header row still reads through.
    expect((sheet?.matrix[1] ?? [])[0]).toBe("Question");
  });

  it("reports formulas in unrelated cells", async () => {
    const inspection = await importFixture("formulas.xlsx");
    expect(inspection.warnings.some((warning) => warning.code === "FORMULAS_PRESENT")).toBe(true);
  });

  it("preserves unicode question text exactly", async () => {
    const inspection = await importFixture("unicode.xlsx");
    const sheet = inspection.sheets[0];
    expect((sheet?.matrix[1] ?? [])[0]).toBe("Does the platform support two-factor authentication (2FA)? 🔐");
    expect((sheet?.matrix[2] ?? [])[0]).toBe("データはどこでホストされていますか？");
    expect((sheet?.matrix[4] ?? [])[0]).toBe("هل تدعمون تسجيل الدخول الموحد؟");
  });

  it("truncates oversized cells and warns (the DB ceiling is 4000 chars)", async () => {
    const inspection = await importFixture("large-cells.xlsx");
    expect(inspection.warnings.some((warning) => warning.code === "LARGE_CELLS")).toBe(true);
    const sheet = inspection.sheets[0];
    const fits = (sheet?.matrix[1] ?? [])[0] ?? ""; // 3509 chars — under the ceiling
    expect(fits).toHaveLength(3509);
    expect(fits.endsWith("END-3500")).toBe(true);
    const truncated = (sheet?.matrix[2] ?? [])[0] ?? ""; // 4609 chars — cut at 4000
    expect(truncated).toHaveLength(4000);
    expect(truncated.endsWith("END-4600")).toBe(false);
  });

  it("imports duplicate question texts as separate rows", async () => {
    const inspection = await importFixture("duplicate-questions.xlsx");
    const sheet = inspection.sheets[0];
    expect(sheet?.rowCount).toBe(4);
    expect((sheet?.matrix[1] ?? [])[0]).toBe((sheet?.matrix[3] ?? [])[0]);
  });

  it("reads odd sheet names and odd column names", async () => {
    const inspection = await importFixture("odd-columns.xlsx");
    const sheet = inspection.sheets[0];
    expect(sheet?.name).toBe("Assessment");
    expect(sheet?.matrix[0]).toEqual(["Item #", "Description of Control", "Your Response", "Reviewer Remarks"]);
  });

  it("carries CSV transport metadata through inspection", async () => {
    const comma = await importFixture("questions.csv");
    expect(comma.csv).toEqual({ delimiter: ",", bom: false, encoding: "utf-8" });
    expect(comma.sheets[0]?.matrix[1]?.[0]).toContain("encrypted, at rest"); // embedded comma survived
    expect(comma.sheets[0]?.matrix[2]?.[0]).toContain("\n"); // embedded newline survived

    const semicolon = await importFixture("questions-semicolon-bom.csv");
    expect(semicolon.csv).toEqual({ delimiter: ";", bom: true, encoding: "utf-8" });
    expect((semicolon.sheets[0]?.matrix[1] ?? [])[0]).toBe("Werden Daten verschlüsselt?");
  });

  it("rejects macro and encrypted packages before parsing", async () => {
    await expect(inspectWorkbook(readFixture("macro.xlsx"), "xlsx")).resolves.toEqual({
      ok: false,
      code: "WORKBOOK_MACROS_UNSUPPORTED",
    });
    await expect(inspectWorkbook(readFixture("encrypted.xlsx"), "xlsx")).resolves.toEqual({
      ok: false,
      code: "WORKBOOK_ENCRYPTED",
    });
  });

  it("fails safely on corrupt and empty workbooks", async () => {
    await expect(inspectWorkbook(readFixture("corrupt.xlsx"), "xlsx")).resolves.toEqual({
      ok: false,
      code: "WORKBOOK_PARSE_FAILED",
    });
    const empty = await importFixture("empty.xlsx");
    expect(empty.sheets[0]?.rowCount).toBe(0);
    await expect(inspectWorkbook(readFixture("empty.csv"), "csv")).resolves.toEqual({
      ok: false,
      code: "WORKBOOK_EMPTY",
    });
  });
});

describe("column detection (suggestions only — never auto-applied)", () => {
  it("detects the canonical Question/Answer/Notes layout", async () => {
    const inspection = await importFixture("single-sheet.xlsx");
    const detection = detectColumns(inspection.sheets[0]!);
    expect(detection.headerRowIndex).toBe(0);
    expect(detection.questionColumn).toBe(0);
    expect(detection.answerColumn).toBe(1);
    expect(detection.notesColumn).toBe(2);
    expect(detection.confidence.question).toBeGreaterThanOrEqual(0.9);
  });

  it("detects odd headers with the question column NOT first", async () => {
    const inspection = await importFixture("odd-columns.xlsx");
    const detection = detectColumns(inspection.sheets[0]!);
    expect(detection.headerRowIndex).toBe(0);
    expect(detection.questionColumn).toBe(1); // "Description of Control"
    expect(detection.answerColumn).toBe(2); // "Your Response"
    expect(detection.notesColumn).toBe(3); // "Reviewer Remarks"
  });

  it("skips a merged title row and finds the real header row", async () => {
    const inspection = await importFixture("merged-headings.xlsx");
    const detection = detectColumns(inspection.sheets[0]!);
    expect(detection.headerRowIndex).toBe(1); // row 2 is the header; row 1 is the merged title
    expect(detection.questionColumn).toBe(0);
    expect(detection.answerColumn).toBe(1);
  });

  it("falls back to content shape when headers are unusual", async () => {
    const inspection = await importFixture("blank-rows.xlsx");
    const detection = detectColumns(inspection.sheets[0]!);
    expect(detection.questionColumn).toBe(0);
  });

  it("prefers genuinely question-like content over prose", async () => {
    const inspection = await importFixture("unicode.xlsx");
    const detection = detectColumns(inspection.sheets[0]!);
    expect(detection.questionColumn).toBe(0);
    expect(detection.confidence.question).toBeGreaterThanOrEqual(0.3);
  });
});

describe("ROUND-TRIP GATE: export preserves the original structure", () => {
  const ANSWERS: Record<string, string> = {};

  beforeAll(() => {
    ANSWERS["Is all customer data encrypted at rest?"] = "AES-256 at rest, TLS 1.3 in transit.";
    ANSWERS["Do you support SSO for enterprise tenants?"] = "SAML 2.0 and OIDC via the identity provider.";
    ANSWERS["Where is production data hosted?"] = "ap-southeast-1, primary + warm standby.";
  });

  async function roundTrip(name: string, sheetName: string, extraAnswers: Record<string, string> = {}) {
    const inspection = await importFixture(name);
    const sheet = inspection.sheets.find((candidate) => candidate.name === sheetName) ?? inspection.sheets[0];
    if (sheet === undefined) throw new Error(`fixture ${name} has no sheet`);
    const detection = detectColumns(sheet);
    if (detection.questionColumn === null || detection.answerColumn === null) {
      throw new Error(`fixture ${name}: detection did not produce a mapping`);
    }

    const locations = answerLocations(
      sheet.matrix,
      detection.questionColumn,
      detection.answerColumn,
      sheet.name,
      detection.headerRowIndex,
      { ...ANSWERS, ...extraAnswers },
    );
    expect(locations.length).toBeGreaterThan(0);

    // Mapping integrity must verify against the untouched original first.
    const original = readFixture(name);
    const verified = await verifyOriginalCells({
      original,
      format: "xlsx",
      expectations: locations.map((location) => ({
        sheetName: location.sheetName,
        rowNumber: location.rowNumber,
        questionCell: columnLetter(detection.questionColumn ?? 0) + String(location.rowNumber),
        expectedText: sheet.matrix[location.rowNumber - 1]?.[detection.questionColumn ?? 0] ?? "",
      })),
    });
    expect(verified).toEqual({ ok: true });

    const result = await writeAnswersToWorkbook({ original, format: "xlsx", answers: locations });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    return { original: inspection, exported: result.value.bytes, locations, sheet, detection };
  }

  it("single sheet: answers land in the mapped cells; unrelated cells, styles, and widths survive", async () => {
    const { exported } = await roundTrip("single-sheet.xlsx", "Sheet1");

    const reopened = await loadRaw(exported);
    expect(reopened.worksheets.map((sheet) => sheet.name)).toEqual(["Sheet1"]);
    expect(reopened.worksheets[0]?.getCell("B2").value).toBe("AES-256 at rest, TLS 1.3 in transit.");
    expect(reopened.worksheets[0]?.getCell("B3").value).toBe("SAML 2.0 and OIDC via the identity provider.");

    // Unrelated sentinel cells are untouched.
    expect(reopened.worksheets[0]?.getCell("F1").value).toBe("SENTINEL-F1-KEEP");
    expect(reopened.worksheets[0]?.getCell("H10").value).toBe("SENTINEL-H10-KEEP");
    // Representative styles: bold header survives the rewrite.
    expect(reopened.worksheets[0]?.getRow(1).font?.bold).toBe(true);
    expect(reopened.worksheets[0]?.getColumn(1).width).toBeCloseTo(46, 0);
    // Pre-existing answer/notes values are untouched unless mapped.
    expect(reopened.worksheets[0]?.getCell("C2").value).toBe("See security whitepaper §2.");
  });

  it("multi sheet: both sheets survive in order; only the mapped sheet gains answers", async () => {
    const { exported } = await roundTrip("multi-sheet.xlsx", "Security", {
      "Is a DPIA available on request?": "Yes, on request.",
    });

    const reopened = await loadRaw(exported);
    expect(reopened.worksheets.map((sheet) => sheet.name)).toEqual(["Security", "Privacy"]);
    expect(reopened.worksheets[1]?.getCell("F1").value).toBe("SENTINEL-Privacy-F1-KEEP");
    // The Privacy sheet was NOT mapped in this round trip... but its question
    // was answered via extraAnswers only if its cells were mapped — they were
    // not, so its answer column must remain untouched. ExcelJS renders an
    // untouched empty cell as null.
    expect(reopened.worksheets[1]?.getCell("B2").value).toBeNull();
  });

  it("merged headings: the merge survives the round trip", async () => {
    const { exported } = await roundTrip("merged-headings.xlsx", "Sheet1");
    const reopened = await loadRaw(exported);
    expect(reopened.worksheets[0]?.model?.merges ?? []).toContain("A1:C1");
    expect(reopened.worksheets[0]?.getCell("A1").value).toBe("Vendor Security Questionnaire 2026");
  });

  it("formulas: unrelated formulas and their cached results survive", async () => {
    const { exported } = await roundTrip("formulas.xlsx", "Sheet1");
    const reopened = await loadRaw(exported);
    const formulaCell = reopened.worksheets[0]?.getCell("E3").value;
    expect(formulaCell).toMatchObject({ formula: "SUM(E1:E2)", result: 3 });
    expect(reopened.worksheets[0]?.getCell("E1").value).toBe(1);
  });

  it("unicode: answer text written next to unicode questions stays intact", async () => {
    const { exported } = await roundTrip("unicode.xlsx", "Sheet1", {
      "Does the platform support two-factor authentication (2FA)? 🔐": "Yes — TOTP and WebAuthn are supported.",
    });
    const reopened = await loadRaw(exported);
    expect(reopened.worksheets[0]?.getCell("A2").value).toContain("🔐");
    expect(reopened.worksheets[0]?.getCell("A3").value).toBe("データはどこでホストされていますか？");
    expect(reopened.worksheets[0]?.getCell("B2").value).toBe("Yes — TOTP and WebAuthn are supported.");
  });

  it("blank rows, duplicates, odd columns: answers reach the right rows", async () => {
    const pool: Record<string, string> = {
      ...ANSWERS,
      "Do you encrypt backups?": "Encrypted, 35-day rotation.",
      "Access control policy is documented and reviewed annually?": "Reviewed annually; board-approved.",
      "Are privileged accounts inventoried and recertified quarterly?": "Yes — quarterly recertification.",
      "Is MFA enforced for all remote access?": "Yes — MFA for all remote access.",
    };
    for (const [fixture, sheet] of [
      ["blank-rows.xlsx", "Sheet1"],
      ["duplicate-questions.xlsx", "Sheet1"],
      ["odd-columns.xlsx", "Assessment"],
    ] as const) {
      const inspection = await importFixture(fixture);
      const target = inspection.sheets.find((candidate) => candidate.name === sheet);
      if (target === undefined) throw new Error(`missing sheet ${sheet}`);
      const detection = detectColumns(target);
      if (detection.questionColumn === null || detection.answerColumn === null) {
        throw new Error(`no mapping for ${fixture}`);
      }
      const locations = target.matrix
        .map((row, index) => ({ text: row[detection.questionColumn ?? 0] ?? "", row: index + 1 }))
        .filter((entry) => pool[entry.text] !== undefined)
        .map((question) => ({
          sheetName: sheet,
          rowNumber: question.row,
          answerCell: columnLetter(detection.answerColumn ?? 1) + String(question.row),
          text: pool[question.text] ?? "",
        }));
      expect(locations.length).toBeGreaterThan(0);

      const result = await writeAnswersToWorkbook({
        original: readFixture(fixture),
        format: "xlsx",
        answers: locations,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      const reopened = await loadRaw(result.value.bytes);
      for (const location of locations) {
        expect(reopened.worksheets[0]?.getCell(location.answerCell).value).toBe(location.text);
      }
    }
  });

  it("CSV: answers land at mapped coordinates; delimiter, BOM, and neighbors are untouched", async () => {
    const inspection = await importFixture("questions.csv");
    const sheet = inspection.sheets[0];
    const csv = inspection.csv;
    expect(csv).not.toBeNull();
    if (sheet === undefined || csv === null) throw new Error("unreachable");

    const original = readFixture("questions.csv");
    const result = await writeAnswersToWorkbook({
      original,
      format: "csv",
      csv: { delimiter: csv.delimiter, bom: csv.bom },
      answers: [
        { sheetName: "CSV", rowNumber: 2, answerCell: "B2", text: "Yes — both." },
        { sheetName: "CSV", rowNumber: 3, answerCell: "B3", text: "Sub A; Sub B; Sub C" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const reopened = await importFixture("questions.csv"); // fixture unchanged on disk
    void reopened;
    const { inspectWorkbook: reinspect } = await import("@/lib/files/questionnaire/inspect");
    const exported = await reinspect(result.value.bytes, "csv");
    expect(exported.ok).toBe(true);
    if (!exported.ok) throw new Error("unreachable");
    expect(exported.value.csv?.delimiter).toBe(",");
    expect(exported.value.csv?.bom).toBe(false);
    const matrix = exported.value.sheets[0]?.matrix ?? [];
    expect(matrix[1]?.[1]).toBe("Yes — both.");
    expect(matrix[2]?.[1]).toBe("Sub A; Sub B; Sub C");
    expect(matrix[2]?.[0]).toContain("List your subprocessors"); // embedded newline neighbor intact
    expect(matrix[3]?.[1]).toBe("Yes"); // untouched pre-existing answer
  });

  it("CSV: semicolon + BOM fixture keeps its transport metadata through export", async () => {
    const result = await writeAnswersToWorkbook({
      original: readFixture("questions-semicolon-bom.csv"),
      format: "csv",
      csv: { delimiter: ";", bom: true },
      answers: [{ sheetName: "CSV", rowNumber: 3, answerCell: "B3", text: "SAML 2.0" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect([...result.value.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8").decode(result.value.bytes).replace(/^﻿/, "");
    expect(text.split("\r\n")[2]).toBe("Gibt es SSO?;SAML 2.0;SAML 2.0");
  });

  it("refuses to export when the mapping no longer matches the original", async () => {
    const mismatch = await verifyOriginalCells({
      original: readFixture("single-sheet.xlsx"),
      format: "xlsx",
      expectations: [
        { sheetName: "Sheet1", rowNumber: 2, questionCell: "A2", expectedText: "A DIFFERENT question entirely" },
      ],
    });
    expect(mismatch).toEqual({ ok: false, code: "EXPORT_MAPPING_INVALID" });

    const missingSheet = await writeAnswersToWorkbook({
      original: readFixture("single-sheet.xlsx"),
      format: "xlsx",
      answers: [{ sheetName: "Renamed Sheet", rowNumber: 2, answerCell: "B2", text: "x" }],
    });
    expect(missingSheet).toEqual({ ok: false, code: "EXPORT_SHEET_MISSING" });

    const csvShort = await writeAnswersToWorkbook({
      original: readFixture("questions.csv"),
      format: "csv",
      csv: { delimiter: ",", bom: false },
      answers: [{ sheetName: "CSV", rowNumber: 99, answerCell: "B99", text: "x" }],
    });
    expect(csvShort).toEqual({ ok: false, code: "EXPORT_MAPPING_INVALID" });

    const csvNoMeta = await writeAnswersToWorkbook({
      original: readFixture("questions.csv"),
      format: "csv",
      answers: [{ sheetName: "CSV", rowNumber: 2, answerCell: "B2", text: "x" }],
    });
    expect(csvNoMeta).toEqual({ ok: false, code: "EXPORT_MAPPING_INVALID" });
  });
});

describe("opt-in summary sheet (plan §9: only when the user enables it)", () => {
  const SUMMARY_ROWS = [
    { question: "Is all customer data encrypted at rest?", answer: "AES-256 at rest.", status: "approved", category: "encryption" },
    { question: "Where is production data hosted?", answer: "", status: "blank_by_choice", category: "hosting" },
  ];

  it("appends the summary sheet last; original sheets stay in order and untouched", async () => {
    const inspection = await importFixture("multi-sheet.xlsx");
    const security = inspection.sheets.find((candidate) => candidate.name === "Security");
    if (security === undefined) throw new Error("missing Security sheet");

    const result = await writeAnswersToWorkbook({
      original: readFixture("multi-sheet.xlsx"),
      format: "xlsx",
      answers: [{ sheetName: "Security", rowNumber: 2, answerCell: "B2", text: "Yes, on request." }],
      summary: { sheetName: "QuestCite Summary", rows: SUMMARY_ROWS },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const reopened = await loadRaw(result.value.bytes);
    expect(reopened.worksheets.map((sheet) => sheet.name)).toEqual(["Security", "Privacy", "QuestCite Summary"]);

    // Original content unchanged; the appended sheet carries header + rows.
    expect(reopened.worksheets[1]?.getCell("F1").value).toBe("SENTINEL-Privacy-F1-KEEP");
    const summary = reopened.worksheets[2];
    expect(summary?.getCell("A1").value).toBe("Question");
    expect(summary?.getCell("B1").value).toBe("Answer");
    expect(summary?.getCell("A2").value).toBe("Is all customer data encrypted at rest?");
    expect(summary?.getCell("B2").value).toBe("AES-256 at rest.");
    expect(summary?.getCell("D2").value).toBe("encryption");
    expect(summary?.getCell("A3").value).toBe("Where is production data hosted?");
    expect(summary?.getCell("B3").value).toBe("");
    expect(summary?.rowCount).toBe(3);
  });

  it("without the option, no summary sheet exists (structure identical to a plain export)", async () => {
    const result = await writeAnswersToWorkbook({
      original: readFixture("single-sheet.xlsx"),
      format: "xlsx",
      answers: [{ sheetName: "Sheet1", rowNumber: 2, answerCell: "B2", text: "Answer." }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const reopened = await loadRaw(result.value.bytes);
    expect(reopened.worksheets.map((sheet) => sheet.name)).toEqual(["Sheet1"]);
  });

  it("is refused for CSV exports (no sheet to append to)", async () => {
    const result = await writeAnswersToWorkbook({
      original: readFixture("questions.csv"),
      format: "csv",
      csv: { delimiter: ",", bom: false },
      answers: [{ sheetName: "CSV", rowNumber: 2, answerCell: "B2", text: "x" }],
      summary: { sheetName: "QuestCite Summary", rows: SUMMARY_ROWS },
    });
    expect(result).toEqual({ ok: false, code: "EXPORT_SUMMARY_UNSUPPORTED" });
  });
});
