import type { DocumentKind } from "@/config/ingestion";

/**
 * Parser contract (plan §9). Every supported format extracts to RAW text;
 * normalization + chunking happen downstream in @/lib/files/chunking.
 *
 * Bump PARSER_VERSION whenever extraction behavior changes in a way that
 * would alter chunk checksums — the version is stored per document_version so
 * a future reprocessing sweep can find stale extractions.
 */

export const PARSER_VERSION = "1";

export type ParsedDocument = {
  text: string;
  kind: DocumentKind;
  pageCount: number | null;
  parserVersion: string;
};

/**
 * Stable uppercase codes only — the underlying library message can contain
 * fragments of document content or server paths, so it NEVER propagates
 * (plan §16 log hygiene). Loggers receive the code; users receive mapped copy.
 */
export type ParserErrorCode =
  | "PARSER_FAILED"
  | "EMPTY_DOCUMENT"
  | "ENCRYPTED_DOCUMENT";

export class ParserError extends Error {
  readonly code: ParserErrorCode;

  constructor(code: ParserErrorCode) {
    super(code);
    this.name = "ParserError";
    this.code = code;
  }
}
