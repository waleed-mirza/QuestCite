import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  DOCUMENT_EXTENSIONS_BY_KIND,
  DOCUMENT_FILENAME_MAX,
  MAX_DOCUMENT_BYTES,
  type DocumentKind,
  type DocumentMimeType,
} from "@/config/ingestion";
import { sha256Hex } from "@/lib/files/checksum";

/**
 * Pre-storage file validation (plan §9): extension, declared MIME, size, and
 * MAGIC BYTES must all agree before anything reaches the bucket.
 *
 * Failure codes are STABLE UPPERCASE constants — the same convention as the
 * database error codes — and are the only things surfaced to users or logs.
 * Never the bytes, never a parser stack, never a server path.
 */

export type FileValidationCode =
  | "DOCUMENT_EMPTY"
  | "DOCUMENT_TOO_LARGE"
  | "DOCUMENT_TYPE_UNSUPPORTED"
  | "EXTENSION_MISMATCH"
  | "FILENAME_INVALID"
  | "ENCODING_UNSUPPORTED";

export type FileValidationFailure = {
  ok: false;
  code: FileValidationCode;
};

export type ValidatedFile = {
  ok: true;
  kind: DocumentKind;
  mime: DocumentMimeType;
  sanitizedFilename: string;
  byteSize: number;
  checksumSha256: string;
};

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 5
    && bytes[0] === 0x25 // '%'
    && bytes[1] === 0x50 // 'P'
    && bytes[2] === 0x44 // 'D'
    && bytes[3] === 0x46 // 'F'
    && bytes[4] === 0x2d; // '-'
}

/** DOCX is a ZIP package: local-file-header magic `PK` + version bytes. */
function startsWithZipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50 // 'P'
    && bytes[1] === 0x4b // 'K'
    && [0x03, 0x05, 0x07].includes(bytes[2] ?? -1)
    && [0x04, 0x06, 0x08].includes(bytes[3] ?? -1);
}

function mimeForKind(kind: DocumentKind): DocumentMimeType {
  switch (kind) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "txt":
      return "text/plain";
    case "md":
      return "text/markdown";
  }
}

function kindForMime(mime: string): DocumentKind | undefined {
  return (["pdf", "docx", "txt", "md"] as const).find((kind) => mimeForKind(kind) === mime);
}

function kindForExtension(filename: string): DocumentKind | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) {
    return null;
  }
  const extension = filename.slice(dot).toLowerCase();
  const match = (["pdf", "docx", "txt", "md"] as const).find(
    (kind) => (DOCUMENT_EXTENSIONS_BY_KIND[kind] as readonly string[]).includes(extension),
  );
  return match ?? null;
}

const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

/**
 * Zero-width space/format characters, bidi marks, and the BOM (U+200B..U+200F,
 * U+2028/U+2029, U+202A..U+202E, U+FEFF): invisible characters with no place
 * in a storage filename — they enable lookalike and RTL-spoofing names.
 * Written as code-point ranges because the characters themselves must never
 * appear in this source file.
 */
function isInvisibleChar(code: number): boolean {
  return (code >= 0x200b && code <= 0x200f)
    || code === 0x2028
    || code === 0x2029
    || (code >= 0x202a && code <= 0x202e)
    || code === 0xfeff;
}

function stripInvisibleChars(value: string): string {
  let out = "";
  for (const char of value) {
    if (!isInvisibleChar(char.codePointAt(0) ?? 0)) {
      out += char;
    }
  }
  return out;
}

/**
 * Reduces a client-supplied filename to a safe single path segment: one
 * basename (drive/URL separators stripped), control/invisible characters
 * removed, whitespace collapsed, leading dots stripped. The result still has
 * to pass validation below — sanitation is best-effort, validation is the gate.
 */
export function sanitizeFilename(rawFilename: string): string {
  const basename = rawFilename.split(/[\\/]/).pop() ?? "";
  const stripped = stripInvisibleChars(basename)
    .replace(CONTROL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+/, "");
  const safe = stripped === "" ? "document" : stripped;
  if (safe.length <= DOCUMENT_FILENAME_MAX) {
    return safe;
  }
  // Preserve the extension when truncating so kind detection still works.
  const dot = safe.lastIndexOf(".");
  if (dot <= 0 || dot === safe.length - 1) {
    return safe.slice(0, DOCUMENT_FILENAME_MAX);
  }
  const extension = safe.slice(dot);
  return safe.slice(0, DOCUMENT_FILENAME_MAX - extension.length) + extension;
}

/**
 * Decodes text bytes as UTF-8 and rejects NUL-containing payloads (a .txt
 * that is really a .docx or UTF-16 export fails here instead of producing
 * garbage chunks).
 */
export function decodeUtf8Text(bytes: Uint8Array): { ok: true; text: string } | { ok: false } {
  if (bytes.includes(0)) {
    return { ok: false };
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    return { ok: true, text: decoder.decode(bytes) };
  } catch {
    return { ok: false };
  }
}

/**
 * Full gate for an uploaded file. Order matters for clear errors:
 * empty → size → filename → allowlist → extension ↔ actual-content agreement.
 * The ACTUAL kind comes from magic bytes (or UTF-8 decodability for text), so
 * `evil.pdf` full of ZIP bytes and `notes.md` full of `%PDF-` both fail with
 * EXTENSION_MISMATCH.
 */
export function validateDocumentFile(
  bytes: Uint8Array,
  rawFilename: string,
  declaredMime: string,
): ValidatedFile | FileValidationFailure {
  if (bytes.byteLength === 0) {
    return { ok: false, code: "DOCUMENT_EMPTY" };
  }
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    return { ok: false, code: "DOCUMENT_TOO_LARGE" };
  }

  const sanitizedFilename = sanitizeFilename(rawFilename);
  if (sanitizedFilename === "" || sanitizedFilename === "document") {
    return { ok: false, code: "FILENAME_INVALID" };
  }

  if (!(ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(declaredMime)) {
    return { ok: false, code: "DOCUMENT_TYPE_UNSUPPORTED" };
  }

  const kind = kindForExtension(sanitizedFilename);
  if (kind === null) {
    return { ok: false, code: "DOCUMENT_TYPE_UNSUPPORTED" };
  }

  // Magic bytes decide the REAL kind — in BOTH directions. A text file whose
  // bytes start with PDF/ZIP magic is a mislabeled binary; a pdf/docx whose
  // bytes lack their magic is a mislabeled text file. (PDF/ZIP content is
  // usually UTF-8-decodable, so a text-only check would let `notes.txt`
  // full of `%PDF-` through to the wrong parser.)
  const looksBinary = startsWithPdfMagic(bytes) || startsWithZipMagic(bytes);
  if (kind === "pdf" || kind === "docx") {
    if (!looksBinary) {
      return { ok: false, code: "EXTENSION_MISMATCH" };
    }
  } else if (looksBinary) {
    return { ok: false, code: "EXTENSION_MISMATCH" };
  } else {
    const decoded = decodeUtf8Text(bytes);
    if (!decoded.ok) {
      return { ok: false, code: "ENCODING_UNSUPPORTED" };
    }
  }

  const declaredKind = kindForMime(declaredMime);
  if (declaredKind !== undefined && declaredKind !== kind) {
    return { ok: false, code: "EXTENSION_MISMATCH" };
  }

  return {
    ok: true,
    kind,
    mime: mimeForKind(kind),
    sanitizedFilename,
    byteSize: bytes.byteLength,
    checksumSha256: sha256Hex(bytes),
  };
}
