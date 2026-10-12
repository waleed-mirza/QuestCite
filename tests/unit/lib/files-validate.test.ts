import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_DOCUMENT_BYTES } from "@/config/ingestion";
import { sanitizeFilename, validateDocumentFile } from "@/lib/files/validate";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(path.resolve("tests/fixtures/documents", name)));

const TEXT_MIME = "text/plain";
const PDF_MIME = "application/pdf";

describe("sanitizeFilename", () => {
  it("keeps only the basename across separators", () => {
    expect(sanitizeFilename("..\\evil\\report.pdf")).toBe("report.pdf");
    expect(sanitizeFilename("https://x.test/a/policy.pdf")).toBe("policy.pdf");
  });

  it("strips control and invisible characters", () => {
    const withControl = `re${String.fromCodePoint(0)}port.pdf`;
    expect(sanitizeFilename(withControl)).toBe("report.pdf");
    // Zero-width space (U+200B) and a bidi mark (U+202E) must not survive.
    const spoof = `re${String.fromCodePoint(0x200b)}po${String.fromCodePoint(0x202e)}rt.pdf`;
    expect(sanitizeFilename(spoof)).toBe("report.pdf");
  });

  it("neutralizes dot-relative and dotfile names", () => {
    expect(sanitizeFilename("..")).toBe("document");
    expect(sanitizeFilename(".")).toBe("document");
    expect(sanitizeFilename(".hidden.pdf")).toBe("hidden.pdf");
  });

  it("caps length while preserving the extension", () => {
    const name = `${"a".repeat(300)}.pdf`;
    const result = sanitizeFilename(name);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith(".pdf")).toBe(true);
  });
});

describe("validateDocumentFile", () => {
  it("accepts a genuine pdf", () => {
    const result = validateDocumentFile(fixture("basic.pdf"), "policy.pdf", PDF_MIME);
    expect(result).toMatchObject({ ok: true, kind: "pdf", byteSize: 1038 });
  });

  it("accepts a genuine docx", () => {
    const result = validateDocumentFile(fixture("basic.docx"), "runbook.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(result).toMatchObject({ ok: true, kind: "docx" });
  });

  it("accepts utf-8 text and markdown", () => {
    expect(validateDocumentFile(fixture("basic.txt"), "notes.txt", TEXT_MIME)).toMatchObject({ ok: true, kind: "txt" });
    expect(validateDocumentFile(fixture("basic.md"), "notes.md", "text/markdown")).toMatchObject({ ok: true, kind: "md" });
  });

  it("rejects empty and oversized files", () => {
    expect(validateDocumentFile(new Uint8Array(0), "a.pdf", PDF_MIME)).toMatchObject({ ok: false, code: "DOCUMENT_EMPTY" });
    expect(validateDocumentFile(new Uint8Array(MAX_DOCUMENT_BYTES + 1), "a.pdf", PDF_MIME)).toMatchObject({
      ok: false,
      code: "DOCUMENT_TOO_LARGE",
    });
  });

  it("rejects disallowed mime types and unknown extensions", () => {
    const bytes = new TextEncoder().encode("hello");
    expect(validateDocumentFile(bytes, "notes.exe", "application/octet-stream")).toMatchObject({ ok: false, code: "DOCUMENT_TYPE_UNSUPPORTED" });
    expect(validateDocumentFile(bytes, "notes.rtf", "text/plain")).toMatchObject({ ok: false, code: "DOCUMENT_TYPE_UNSUPPORTED" });
  });

  it("rejects misleading extensions in both directions", () => {
    // PDF bytes wearing a .txt name.
    expect(validateDocumentFile(fixture("basic.pdf"), "notes.txt", TEXT_MIME)).toMatchObject({ ok: false, code: "EXTENSION_MISMATCH" });
    // Text bytes wearing a .pdf name (starts with "Trust...", not %PDF-).
    expect(validateDocumentFile(fixture("basic.txt"), "notes.pdf", PDF_MIME)).toMatchObject({ ok: false, code: "EXTENSION_MISMATCH" });
    // Declared mime disagrees with extension even when magic would pass.
    expect(validateDocumentFile(fixture("basic.pdf"), "notes.pdf", TEXT_MIME)).toMatchObject({ ok: false, code: "EXTENSION_MISMATCH" });
  });

  it("rejects non-utf8 text payloads", () => {
    const utf16 = new Uint8Array([0x68, 0x00, 0x69, 0x00]); // "h\0i\0" — UTF-16LE with NULs
    expect(validateDocumentFile(utf16, "notes.txt", TEXT_MIME)).toMatchObject({ ok: false, code: "ENCODING_UNSUPPORTED" });
  });

  it("produces a stable sha256 checksum", () => {
    const first = validateDocumentFile(fixture("basic.md"), "a.md", "text/markdown");
    const second = validateDocumentFile(fixture("basic.md"), "a.md", "text/markdown");
    if (!first.ok || !second.ok) {
      throw new Error("expected both validations to pass");
    }
    expect(first.checksumSha256).toBe(second.checksumSha256);
    expect(first.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
