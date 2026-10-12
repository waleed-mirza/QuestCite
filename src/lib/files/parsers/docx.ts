import mammoth from "mammoth";

import { ParserError } from "@/lib/files/parsers/types";

/**
 * DOCX semantic text extraction (plan §6: mammoth). extractRawText yields the
 * document's text content in reading order; paragraph boundaries come back as
 * "\n\n", which is exactly the shape chunking's block splitter expects.
 *
 * mammoth warnings (unsupported features like textboxes) are intentionally
 * dropped — they can quote document fragments, and extraction either produced
 * text or a ParserError.
 */
export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return result.value;
  } catch {
    throw new ParserError("PARSER_FAILED");
  }
}
