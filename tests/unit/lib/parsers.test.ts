import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseDocument } from "@/lib/files/parsers";
import { PARSER_VERSION, ParserError } from "@/lib/files/parsers/types";
import { validateDocumentFile } from "@/lib/files/validate";

/**
 * Golden parser fixtures (plan §W3 tests) + the unsafe-file matrix:
 * empty, corrupt, encrypted, scanned, misleading-extension cases.
 */

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(path.resolve("tests/fixtures/documents", name)));

const expectParserError = async (run: () => Promise<unknown>, code: ParserError["code"]): Promise<void> => {
  try {
    await run();
    expect.unreachable(`expected ParserError(${code})`);
  } catch (error) {
    expect(error).toBeInstanceOf(ParserError);
    expect((error as ParserError).code).toBe(code);
  }
};

describe("golden fixtures", () => {
  it("extracts txt exactly (raw bytes preserved, no trimming)", async () => {
    const parsed = await parseDocument(fixture("basic.txt"), "txt");
    expect(parsed.text).toBe("QuestCite onboarding checklist\n\nEnable MFA for all admins.\nReview vendor list quarterly.\n");
    expect(parsed).toMatchObject({ kind: "txt", pageCount: null, parserVersion: PARSER_VERSION });
  });

  it("extracts markdown with headings intact", async () => {
    const parsed = await parseDocument(fixture("basic.md"), "md");
    expect(parsed.text).toContain("# Access Control Policy");
    expect(parsed.text).toContain("## Session Management");
    expect(parsed.text).toContain("Sessions expire after 30 minutes of inactivity.");
  });

  it("extracts pdf text across pages with page count", async () => {
    const parsed = await parseDocument(fixture("basic.pdf"), "pdf");
    expect(parsed.pageCount).toBe(2);
    expect(parsed.text).toContain("Encryption at Rest");
    expect(parsed.text).toContain("Customer data is encrypted with AES-256.");
    expect(parsed.text).toContain("Backups are encrypted with separate keys.");
  });

  it("extracts docx paragraphs in order", async () => {
    const parsed = await parseDocument(fixture("basic.docx"), "docx");
    expect(parsed.text).toContain("Incident Response Overview");
    expect(parsed.text).toContain("Severity 1 incidents page the on-call engineer within five minutes.");
    const first = parsed.text.indexOf("Incident Response Overview");
    const second = parsed.text.indexOf("Severity 1 incidents");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
  });
});

describe("unsafe inputs fail safely", () => {
  it("rejects empty text files as EMPTY_DOCUMENT", async () => {
    await expectParserError(() => parseDocument(fixture("empty.txt"), "txt"), "EMPTY_DOCUMENT");
  });

  it("rejects scanned (image-only) pdfs as EMPTY_DOCUMENT", async () => {
    await expectParserError(() => parseDocument(fixture("scanned.pdf"), "pdf"), "EMPTY_DOCUMENT");
  });

  it("rejects encrypted pdfs as ENCRYPTED_DOCUMENT", async () => {
    await expectParserError(() => parseDocument(fixture("encrypted.pdf"), "pdf"), "ENCRYPTED_DOCUMENT");
  });

  it("rejects corrupt pdfs as PARSER_FAILED", async () => {
    await expectParserError(() => parseDocument(fixture("corrupt.pdf"), "pdf"), "PARSER_FAILED");
  });

  it("never leaks library messages — ParserError message is the code", async () => {
    try {
      await parseDocument(fixture("corrupt.pdf"), "pdf");
      expect.unreachable();
    } catch (error) {
      expect((error as ParserError).message).toBe("PARSER_FAILED");
    }
  });
});

describe("misleading extensions are stopped before parsing", () => {
  it("pdf bytes named .txt fail validation with EXTENSION_MISMATCH", () => {
    const result = validateDocumentFile(fixture("basic.pdf"), "notes.txt", "text/plain");
    expect(result).toMatchObject({ ok: false, code: "EXTENSION_MISMATCH" });
  });

  it("corrupt pdf bytes named .pdf pass validation (magic ok) but fail parsing", async () => {
    const result = validateDocumentFile(fixture("corrupt.pdf"), "corrupt.pdf", "application/pdf");
    expect(result).toMatchObject({ ok: true, kind: "pdf" });
    await expectParserError(() => parseDocument(fixture("corrupt.pdf"), "pdf"), "PARSER_FAILED");
  });
});
