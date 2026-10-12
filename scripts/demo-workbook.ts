import ExcelJS from "exceljs";

import {
  DEMO_DOCUMENTS,
  DEMO_QUESTIONS,
  DEMO_QUESTIONNAIRE_SHEET,
  type DemoQuestion,
} from "../src/features/demo/data";

const FIXED_DATE = new Date("2026-09-04T00:00:00.000Z");

export type DemoWorkbookMode = "original" | "completed";

/**
 * Builds the fictional 40-question workbook used by both the public download
 * and the idempotent database seed. The original mode is deliberately blank;
 * completed mode contains only the stored demo results.
 */
export async function createDemoWorkbook(mode: DemoWorkbookMode): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "QuestCite demo fixture";
  workbook.created = FIXED_DATE;
  workbook.modified = FIXED_DATE;

  const sheet = workbook.addWorksheet(DEMO_QUESTIONNAIRE_SHEET);
  sheet.columns = [
    { header: "Question", key: "question", width: 64 },
    { header: "Answer", key: "answer", width: 72 },
    { header: "Evidence", key: "evidence", width: 28 },
    { header: "Status", key: "status", width: 24 },
    { header: "Category", key: "category", width: 22 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  DEMO_QUESTIONS.forEach((question, index) => {
    const row = index + 2;
    sheet.getCell(`A${row}`).value = question.question;
    sheet.getCell(`B${row}`).value = mode === "completed" ? question.answer : null;
    sheet.getCell(`C${row}`).value = mode === "completed" ? evidenceLabel(question) : null;
    sheet.getCell(`D${row}`).value = mode === "completed" ? statusLabel(question) : null;
    sheet.getCell(`E${row}`).value = question.category;
    sheet.getRow(row).alignment = { vertical: "top", wrapText: true };
  });

  const note = sheet.getCell("A44");
  note.value = "SAMPLE DATA — NOT LEGAL OR COMPLIANCE ADVICE.";
  note.font = { italic: true, color: { argb: "FF9A6700" } };
  sheet.mergeCells("A44:E44");

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function evidenceLabel(question: DemoQuestion): string {
  if (question.sourceKey === null) {
    return "None — manual review";
  }
  return DEMO_DOCUMENTS.find((document) => document.key === question.sourceKey)?.title ?? "Demo evidence";
}

function statusLabel(question: DemoQuestion): string {
  if (question.disposition === "answered") {
    return "AI drafted";
  }
  if (question.disposition === "needs_review") {
    return "Needs review";
  }
  return "Insufficient evidence";
}
