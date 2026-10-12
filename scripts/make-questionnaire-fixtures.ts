import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";

/**
 * Generates the questionnaire workbook fixture corpus (plan §18-W4 tests:
 * multiple sheets, blank rows, merged headings, formulas, unicode, large
 * cells, duplicate questions, odd column names, CSV delimiters, macro/
 * encrypted rejection).
 *
 * Run: pnpm tsx scripts/make-questionnaire-fixtures.ts
 * Output: tests/fixtures/questionnaires/*
 *
 * Fixtures are committed; regenerate only when a fixture's CONTENT must
 * change — the round-trip gate asserts exact cell values, merges, formulas,
 * and styles against them, so regeneration is a reviewable change.
 */

const OUT_DIR = path.resolve("tests/fixtures/questionnaires");

// Deterministic workbook metadata so regenerated fixtures diff cleanly.
const FIXED_DATE = new Date("2026-09-02T00:00:00Z");

type SheetSpec = {
  name: string;
  header: string[];
  questions: Array<{ question: string; answer?: string; note?: string }>;
};

// ---------------------------------------------------------------------------
// Minimal ZIP writer (store) for the macro/encrypted rejection fixtures —
// these are NOT parseable workbooks; the zip safety scanner must reject them
// BEFORE any parse attempt, which is exactly what the tests assert.
// ---------------------------------------------------------------------------

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 0;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (const byte of buffer) {
    const entry = crc32Table[(crc ^ byte) & 0xff] ?? 0;
    crc = ((crc >>> 8) ^ entry) >>> 0;
  }
  return (crc ^ -1) >>> 0;
}

function buildZip(files: Array<{ name: string; content: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, "utf8");
    const crc = crc32(file.content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.content.length, 18);
    local.writeUInt32LE(file.content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, file.content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.content.length, 20);
    central.writeUInt32LE(file.content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + file.content.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralDirectory, eocd]);
}

const junkEntry = (tag: string): Buffer => Buffer.from(`fixture placeholder content: ${tag}\n`, "utf8");

// ---------------------------------------------------------------------------

const HEADER = ["Question", "Answer", "Notes"];

const BASIC_QUESTIONS: SheetSpec["questions"] = [
  {
    question: "Is all customer data encrypted at rest?",
    answer: "Yes — AES-256.",
    note: "See security whitepaper §2.",
  },
  { question: "Do you support SSO for enterprise tenants?", note: "SAML asked for." },
  { question: "Where is production data hosted?" },
];

mkdirSync(OUT_DIR, { recursive: true });
const write = (name: string, content: Buffer | string): void => {
  writeFileSync(path.join(OUT_DIR, name), content);
  console.log("wrote", name);
};

async function main(): Promise<void> {
  // 1. Clean single sheet + bold header + sentinels + column width.
  const single = new ExcelJS.Workbook();
  single.creator = "QuestCite fixtures";
  single.created = FIXED_DATE;
  single.modified = FIXED_DATE;
  const singleSheet = single.addWorksheet("Sheet1");
  HEADER.forEach((value, index) => {
    singleSheet.getRow(1).getCell(index + 1).value = value;
  });
  singleSheet.getRow(1).font = { bold: true };
  BASIC_QUESTIONS.forEach((question, questionIndex) => {
    const row = singleSheet.getRow(questionIndex + 2);
    row.getCell(1).value = question.question;
    if (question.answer !== undefined) row.getCell(2).value = question.answer;
    if (question.note !== undefined) row.getCell(3).value = question.note;
  });
  singleSheet.getColumn(1).width = 46;
  singleSheet.getCell("F1").value = "SENTINEL-F1-KEEP";
  singleSheet.getCell("H10").value = "SENTINEL-H10-KEEP";
  write("single-sheet.xlsx", Buffer.from(await single.xlsx.writeBuffer()));

  // 2. Two sheets, each with its own header + questions (MULTIPLE_SHEETS).
  const multi = new ExcelJS.Workbook();
  multi.creator = "QuestCite fixtures";
  multi.created = FIXED_DATE;
  multi.modified = FIXED_DATE;
  for (const spec of [
    { name: "Security", questions: BASIC_QUESTIONS },
    { name: "Privacy", questions: [{ question: "Is a DPIA available on request?" }] },
  ] as SheetSpec[]) {
    const sheet = multi.addWorksheet(spec.name);
    HEADER.forEach((value, index) => {
      sheet.getRow(1).getCell(index + 1).value = value;
    });
    sheet.getRow(1).font = { bold: true };
    spec.questions.forEach((question, questionIndex) => {
      const row = sheet.getRow(questionIndex + 2);
      row.getCell(1).value = question.question;
      if (question.answer !== undefined) row.getCell(2).value = question.answer;
      if (question.note !== undefined) row.getCell(3).value = question.note;
    });
    sheet.getCell("F1").value = `SENTINEL-${spec.name}-F1-KEEP`;
  }
  write("multi-sheet.xlsx", Buffer.from(await multi.xlsx.writeBuffer()));

  // 3. Blank rows between questions.
  const blanks = new ExcelJS.Workbook();
  blanks.created = FIXED_DATE;
  blanks.modified = FIXED_DATE;
  const blanksSheet = blanks.addWorksheet("Sheet1");
  HEADER.forEach((value, index) => {
    blanksSheet.getRow(1).getCell(index + 1).value = value;
  });
  blanksSheet.getRow(1).font = { bold: true };
  [2, 4, 7].forEach((rowNumber, questionIndex) => {
    blanksSheet.getRow(rowNumber).getCell(1).value = BASIC_QUESTIONS[questionIndex]?.question ?? "Filler question?";
  });
  write("blank-rows.xlsx", Buffer.from(await blanks.xlsx.writeBuffer()));

  // 4. Merged title heading above the real header row.
  const merged = new ExcelJS.Workbook();
  merged.created = FIXED_DATE;
  merged.modified = FIXED_DATE;
  const mergedSheet = merged.addWorksheet("Sheet1");
  mergedSheet.mergeCells("A1:C1");
  mergedSheet.getCell("A1").value = "Vendor Security Questionnaire 2026";
  mergedSheet.getCell("A1").font = { bold: true, size: 14 };
  HEADER.forEach((value, index) => {
    mergedSheet.getRow(2).getCell(index + 1).value = value;
  });
  mergedSheet.getRow(2).font = { bold: true };
  BASIC_QUESTIONS.forEach((question, questionIndex) => {
    const row = mergedSheet.getRow(questionIndex + 3);
    row.getCell(1).value = question.question;
    if (question.answer !== undefined) row.getCell(2).value = question.answer;
  });
  write("merged-headings.xlsx", Buffer.from(await merged.xlsx.writeBuffer()));

  // 5. Formula in an UNRELATED cell (must survive round-trip).
  const formulas = new ExcelJS.Workbook();
  formulas.created = FIXED_DATE;
  formulas.modified = FIXED_DATE;
  const formulasSheet = formulas.addWorksheet("Sheet1");
  HEADER.forEach((value, index) => {
    formulasSheet.getRow(1).getCell(index + 1).value = value;
  });
  formulasSheet.getRow(1).font = { bold: true };
  formulasSheet.getRow(2).getCell(1).value = BASIC_QUESTIONS[0]?.question ?? "";
  formulasSheet.getRow(3).getCell(1).value = BASIC_QUESTIONS[1]?.question ?? "";
  formulasSheet.getCell("E1").value = 1;
  formulasSheet.getCell("E2").value = 2;
  formulasSheet.getCell("E3").value = { formula: "SUM(E1:E2)", result: 3 };
  write("formulas.xlsx", Buffer.from(await formulas.xlsx.writeBuffer()));

  // 6. Unicode: emoji, CJK, accents, RTL.
  const unicode = new ExcelJS.Workbook();
  unicode.created = FIXED_DATE;
  unicode.modified = FIXED_DATE;
  const unicodeSheet = unicode.addWorksheet("Sheet1");
  HEADER.forEach((value, index) => {
    unicodeSheet.getRow(1).getCell(index + 1).value = value;
  });
  unicodeSheet.getRow(1).font = { bold: true };
  [
    "Does the platform support two-factor authentication (2FA)? 🔐",
    "データはどこでホストされていますか？",
    "Le chiffrement des données est-il conforme ? éèüç",
    "هل تدعمون تسجيل الدخول الموحد؟",
  ].forEach((question, questionIndex) => {
    unicodeSheet.getRow(questionIndex + 2).getCell(1).value = question;
  });
  write("unicode.xlsx", Buffer.from(await unicode.xlsx.writeBuffer()));

  // 7. Large cells: one at 3500 chars (fits), one at 4600 (inspection cap).
  const large = new ExcelJS.Workbook();
  large.created = FIXED_DATE;
  large.modified = FIXED_DATE;
  const largeSheet = large.addWorksheet("Sheet1");
  HEADER.forEach((value, index) => {
    largeSheet.getRow(1).getCell(index + 1).value = value;
  });
  largeSheet.getRow(1).font = { bold: true };
  const filler = (length: number, seed: string): string =>
    (seed + " ").repeat(Math.ceil(length / (seed.length + 1))).slice(0, length);
  largeSheet.getRow(2).getCell(1).value = `${filler(3500, "Describe your log retention pipeline.")} END-3500`;
  largeSheet.getRow(3).getCell(1).value = `${filler(4600, "Describe your incident response runbook.")} END-4600`;
  write("large-cells.xlsx", Buffer.from(await large.xlsx.writeBuffer()));

  // 8. Duplicate question texts at different rows.
  const duplicates = new ExcelJS.Workbook();
  duplicates.created = FIXED_DATE;
  duplicates.modified = FIXED_DATE;
  const duplicatesSheet = duplicates.addWorksheet("Sheet1");
  HEADER.forEach((value, index) => {
    duplicatesSheet.getRow(1).getCell(index + 1).value = value;
  });
  duplicatesSheet.getRow(1).font = { bold: true };
  duplicatesSheet.getRow(2).getCell(1).value = "Do you encrypt backups?";
  duplicatesSheet.getRow(3).getCell(1).value = "Do you encrypt backups?";
  duplicatesSheet.getRow(4).getCell(1).value = "Do you encrypt backups?";
  write("duplicate-questions.xlsx", Buffer.from(await duplicates.xlsx.writeBuffer()));

  // 9. Odd column names; question column NOT first; empty response column.
  const odd = new ExcelJS.Workbook();
  odd.created = FIXED_DATE;
  odd.modified = FIXED_DATE;
  const oddSheet = odd.addWorksheet("Assessment");
  const oddHeader = ["Item #", "Description of Control", "Your Response", "Reviewer Remarks"];
  oddHeader.forEach((value, index) => {
    oddSheet.getRow(1).getCell(index + 1).value = value;
  });
  oddSheet.getRow(1).font = { bold: true };
  [
    ["AC-1", "Access control policy is documented and reviewed annually?"],
    ["AC-2", "Are privileged accounts inventoried and recertified quarterly?"],
    ["IA-1", "Is MFA enforced for all remote access?"],
  ].forEach(([code, question], questionIndex) => {
    const row = oddSheet.getRow(questionIndex + 2);
    row.getCell(1).value = code;
    row.getCell(2).value = question;
  });
  write("odd-columns.xlsx", Buffer.from(await odd.xlsx.writeBuffer()));

  // 10. CSV, comma delimiter, quoted fields with embedded comma + newline, no BOM.
  //     Files end WITH a line break (RFC 4180 allows both; ending with one keeps
  //     the byte round-trip test exact — serializeCsv always emits a final \r\n).
  const csvComma = [
    "Question,Answer,Notes",
    '"Is data encrypted, at rest and in transit?",Yes,AES-256 + TLS 1.3',
    '"List your subprocessors\n(one per line)","Sub A, Sub B",annual review',
    'Do you log admin actions?,Yes,sample retained 90 days',
  ].join("\r\n") + "\r\n";
  write("questions.csv", Buffer.from(csvComma, "utf8"));

  // 11. CSV, semicolon delimiter + UTF-8 BOM.
  const csvSemicolon = [
    "Frage;Antwort;Notizen",
    "Werden Daten verschlüsselt?;Ja;AES-256",
    "Gibt es SSO?;Ja;SAML 2.0",
  ].join("\r\n") + "\r\n";
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  write("questions-semicolon-bom.csv", Buffer.concat([bom, Buffer.from(csvSemicolon, "utf8")]));

  // 12/13. Macro + encrypted package rejections (scanner must catch them).
  write(
    "macro.xlsx",
    buildZip([
      { name: "[Content_Types].xml", content: junkEntry("content types") },
      { name: "xl/workbook.xml", content: junkEntry("workbook") },
      { name: "xl/vbaProject.bin", content: junkEntry("vba project") },
    ]),
  );
  write(
    "encrypted.xlsx",
    buildZip([
      { name: "EncryptionInfo", content: junkEntry("encryption info") },
      { name: "EncryptedPackage", content: junkEntry("encrypted package") },
    ]),
  );

  // 14. Corrupt: PK header but no valid structure (parser must fail safely).
  write(
    "corrupt.xlsx",
    Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(512, 0x41)]),
  );

  // 15. Empty workbook (one sheet, no content) + empty CSV.
  const empty = new ExcelJS.Workbook();
  empty.created = FIXED_DATE;
  empty.modified = FIXED_DATE;
  empty.addWorksheet("Sheet1");
  write("empty.xlsx", Buffer.from(await empty.xlsx.writeBuffer()));
  write("empty.csv", Buffer.from("", "utf8"));

  console.log("done:", OUT_DIR);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
