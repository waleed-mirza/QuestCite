import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { DEMO_QUESTIONS, DEMO_QUESTIONNAIRE_SHEET } from "@/features/demo/data";
import { createDemoWorkbook } from "../../../scripts/demo-workbook";

describe("demo workbook generator", () => {
  it("keeps the original blank and the completed fixture answerable", async () => {
    const originalBytes = await createDemoWorkbook("original");
    const completedBytes = await createDemoWorkbook("completed");
    const original = new ExcelJS.Workbook();
    const completed = new ExcelJS.Workbook();
    await original.xlsx.load(new Uint8Array(originalBytes).slice().buffer);
    await completed.xlsx.load(new Uint8Array(completedBytes).slice().buffer);

    const originalSheet = original.getWorksheet(DEMO_QUESTIONNAIRE_SHEET);
    const completedSheet = completed.getWorksheet(DEMO_QUESTIONNAIRE_SHEET);
    expect(originalSheet).toBeDefined();
    expect(completedSheet).toBeDefined();
    expect(originalSheet?.getCell("B2").value).toBeNull();
    expect(completedSheet?.getCell("B2").value).toBe(DEMO_QUESTIONS[0]?.answer);
    expect(completedSheet?.getCell("A41").value).toBe(DEMO_QUESTIONS[40 - 1]?.question);
    expect(completedSheet?.getCell("A44").value).toContain("SAMPLE DATA");
  });
});
