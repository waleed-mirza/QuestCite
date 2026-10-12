/**
 * Client-safe ingestion constants (plan §9).
 *
 * Mirrors the hard ceilings in `private.ingestion_limits` (migration 0003):
 * the database remains authoritative — these values exist so the UI can give
 * instant feedback before a byte is uploaded. Drift surfaces as a mapped
 * database error code, never as silently accepted input.
 *
 * MAY be imported from Client Components. Anything that needs secrets belongs
 * in @/lib/* behind `server-only`.
 */

/** Hard per-document ceiling; also enforced by a DB CHECK as backstop. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** MIME allowlist — must stay in sync with the storage bucket + RPC checks. */
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
] as const;

export type DocumentMimeType = (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number];

/** Parser-supported file kinds (plan §9: PDF, DOCX, TXT, Markdown). */
export type DocumentKind = "pdf" | "docx" | "txt" | "md";

/** File extensions accepted per kind (used for the extension↔magic check). */
export const DOCUMENT_EXTENSIONS_BY_KIND: Record<DocumentKind, readonly string[]> = {
  pdf: [".pdf"],
  docx: [".docx"],
  txt: [".txt"],
  md: [".md", ".markdown"],
};

/**
 * Chunk sizing (plan §9: ~600–900 tokens with modest overlap). Tokens are
 * ESTIMATED at ~4 characters/token (OpenAI's guidance for English prose) —
 * the stored `token_count` is this estimate, not a tokenizer-exact figure.
 */
export const CHUNK_MIN_TOKENS = 600;
export const CHUNK_MAX_TOKENS = 900;
export const CHUNK_OVERLAP_TOKENS = 100;
export const TOKEN_CHARS = 4;

/** Database-enforced retry cap (private.ingestion_limits) — mirrored for UI. */
export const MAX_PROCESSING_RETRIES = 3;

export const DOCUMENT_TITLE_MAX = 200;
export const DOCUMENT_CATEGORY_MAX = 80;
export const DOCUMENT_TAGS_MAX = 20;
export const DOCUMENT_TAG_MAX = 40;
export const DOCUMENT_FILENAME_MAX = 200;
