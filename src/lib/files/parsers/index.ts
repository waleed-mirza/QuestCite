import "server-only";

import type { DocumentKind } from "@/config/ingestion";

import { extractDocxText } from "@/lib/files/parsers/docx";
import { extractPdfText } from "@/lib/files/parsers/pdf";
import { extractTextBytes } from "@/lib/files/parsers/text";
import { PARSER_VERSION, ParserError, type ParsedDocument, type ParserErrorCode } from "@/lib/files/parsers/types";

/**
 * Parser registry (plan §9). Entry point for the ingestion service — the only
 * import surface features/ code should use. Heavy parser libraries load here,
 * which is why this module is `server-only`.
 */
export async function parseDocument(bytes: Uint8Array, kind: DocumentKind): Promise<ParsedDocument> {
  let text: string;
  let pageCount: number | null = null;

  switch (kind) {
    case "txt":
    case "md":
      text = extractTextBytes(bytes);
      break;
    case "pdf": {
      const parsed = await extractPdfText(bytes);
      text = parsed.text;
      pageCount = parsed.pageCount;
      break;
    }
    case "docx":
      text = await extractDocxText(bytes);
      break;
  }

  // A parsed-but-blank extraction (scanned/image-only PDF, empty DOCX body,
  // whitespace-only TXT) is a SAFE terminal failure, not a crash (plan §9).
  if (text.trim() === "") {
    throw new ParserError("EMPTY_DOCUMENT");
  }

  return { text, kind, pageCount, parserVersion: PARSER_VERSION };
}

export { PARSER_VERSION, ParserError, type ParsedDocument, type ParserErrorCode };
