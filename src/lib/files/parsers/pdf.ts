import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";

import { ParserError } from "@/lib/files/parsers/types";

/**
 * PDF text extraction (plan §6: pdfjs-dist, text PDFs only, no OCR).
 *
 * Text items are joined preserving line breaks via `hasEOL`, so headings and
 * paragraph structure survive into chunking. A document whose pages expose no
 * text items at all is a scanned/image-only PDF — reported as EMPTY_DOCUMENT
 * by the registry (plan §9: scanned-only PDFs are explicitly unsupported).
 *
 * All failures map to ParserError codes; pdfjs messages can embed document
 * fragments and are swallowed here by design.
 */

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return "str" in item && typeof item.str === "string";
}

export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pageCount: number }> {
  // pdfjs may transfer (detach) the passed buffer — hand it a private copy so
  // the caller's bytes stay usable (checksum comparison happens later).
  const privateCopy = new Uint8Array(bytes.byteLength);
  privateCopy.set(bytes);

  const loadingTask = getDocument({
    data: privateCopy,
    disableFontFace: true,
    useSystemFonts: false,
  });

  let doc: Awaited<typeof loadingTask.promise>;
  try {
    doc = await loadingTask.promise;
  } catch (error) {
    await loadingTask.destroy();
    // Encrypted PDFs (even without a user password) surface as
    // PasswordException before any page can be read.
    if (error instanceof Error && error.name === "PasswordException") {
      throw new ParserError("ENCRYPTED_DOCUMENT");
    }
    throw new ParserError("PARSER_FAILED");
  }

  try {
    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = "";
      for (const item of content.items) {
        if (!isTextItem(item)) {
          continue;
        }
        pageText += item.str;
        if (item.hasEOL) {
          pageText += "\n";
        }
      }
      pageTexts.push(pageText.trim());
      page.cleanup();
    }
    return { text: pageTexts.join("\n\n"), pageCount: doc.numPages };
  } catch {
    throw new ParserError("PARSER_FAILED");
  } finally {
    await loadingTask.destroy();
  }
}
