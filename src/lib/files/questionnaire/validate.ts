import {
  ALLOWED_QUESTIONNAIRE_MIME_TYPES,
  MAX_QUESTIONNAIRE_FILE_BYTES,
  QUESTIONNAIRE_EXTENSIONS_BY_FORMAT,
  QUESTIONNAIRE_FILENAME_MAX,
  type QuestionnaireFormat,
  type QuestionnaireMimeType,
} from "@/config/questionnaires";
import { sha256Hex } from "@/lib/files/checksum";

/**
 * Pre-storage questionnaire validation (plan §9): extension, declared MIME,
 * size, and MAGIC BYTES must agree before anything reaches the bucket or the
 * parser. Same gate discipline as documents (src/lib/files/validate.ts) —
 * `evil.xlsx` full of text and `notes.csv` full of ZIP bytes both fail here.
 *
 * CSV accepts the BOM-declared encodings the CSV parser supports (UTF-8,
 * UTF-16LE/BE via BOM); a BOM-less file must be strict UTF-8 text. Failure
 * codes are STABLE UPPERCASE constants — never bytes, paths, or content.
 */

export type QuestionnaireFileValidationCode =
  | "QUESTIONNAIRE_EMPTY"
  | "QUESTIONNAIRE_TOO_LARGE"
  | "QUESTIONNAIRE_TYPE_UNSUPPORTED"
  | "EXTENSION_MISMATCH"
  | "FILENAME_INVALID"
  | "ENCODING_UNSUPPORTED";

export type QuestionnaireFileValidationFailure = {
  ok: false;
  code: QuestionnaireFileValidationCode;
};

export type ValidatedQuestionnaireFile = {
  ok: true;
  format: QuestionnaireFormat;
  mime: QuestionnaireMimeType;
  sanitizedFilename: string;
  byteSize: number;
  checksumSha256: string;
};

/** XLSX is a ZIP package: local-file-header magic `PK` + version bytes. */
function startsWithZipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50 // 'P'
    && bytes[1] === 0x4b // 'K'
    && [0x03, 0x05, 0x07].includes(bytes[2] ?? -1)
    && [0x04, 0x06, 0x08].includes(bytes[3] ?? -1);
}

function hasBom(bytes: Uint8Array): { encoding: "utf-8" | "utf-16le" | "utf-16be" } | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: "utf-8" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: "utf-16le" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: "utf-16be" };
  }
  return null;
}

/**
 * Whether the bytes decode as text in an encoding the CSV parser supports.
 * BOM-declared UTF-16 is checked by decoding alone (its ASCII text inherently
 * contains NUL high bytes). A BOM-less file must be strict UTF-8 with no NUL
 * byte — NULs mean binary masquerading as CSV (or UTF-16 that lost its BOM).
 */
function isSupportedCsvText(bytes: Uint8Array): "ok" | "binary" | "encoding" {
  const bom = hasBom(bytes);
  if (bom === null && bytes.includes(0)) {
    return "binary";
  }
  try {
    new TextDecoder(bom?.encoding ?? "utf-8", { fatal: true }).decode(bytes);
    return "ok";
  } catch {
    return "encoding";
  }
}

const CONTROL_CHAR = /[\x00-\x1f\x7f]/;

/**
 * Zero-width/bidi/invisible characters have no place in a storage filename —
 * they enable lookalike and RTL-spoofing names (see validate.ts for the same
 * ranges, written as code points so the characters never appear in source).
 */
function isInvisibleChar(code: number): boolean {
  return (code >= 0x200b && code <= 0x200f)
    || code === 0x2028
    || code === 0x2029
    || (code >= 0x202a && code <= 0x202e)
    || code === 0xfeff;
}

function sanitizeQuestionnaireFilename(rawFilename: string): string {
  const basename = rawFilename.split(/[\\/]/).pop() ?? "";
  let out = "";
  for (const char of basename) {
    const code = char.codePointAt(0) ?? 0;
    if (isInvisibleChar(code)) {
      continue;
    }
    if (!CONTROL_CHAR.test(char)) {
      out += char;
    }
  }
  const collapsed = out.replace(/\s+/g, " ").trim().replace(/^[. ]+/, "");
  const safe = collapsed === "" ? "questionnaire" : collapsed;
  if (safe.length <= QUESTIONNAIRE_FILENAME_MAX) {
    return safe;
  }
  const dot = safe.lastIndexOf(".");
  if (dot <= 0 || dot === safe.length - 1) {
    return safe.slice(0, QUESTIONNAIRE_FILENAME_MAX);
  }
  const extension = safe.slice(dot);
  return safe.slice(0, QUESTIONNAIRE_FILENAME_MAX - extension.length) + extension;
}

function formatForExtension(filename: string): QuestionnaireFormat | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) {
    return null;
  }
  const extension = filename.slice(dot).toLowerCase();
  const formats: QuestionnaireFormat[] = ["xlsx", "csv"];
  return formats.find((format) => (QUESTIONNAIRE_EXTENSIONS_BY_FORMAT[format] as readonly string[]).includes(extension)) ?? null;
}

function mimeForFormat(format: QuestionnaireFormat): QuestionnaireMimeType {
  return format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

/**
 * Full gate for an uploaded questionnaire. Order matters for clear errors:
 * empty → size → filename → MIME allowlist → extension → content agreement.
 */
export function validateQuestionnaireFile(
  bytes: Uint8Array,
  rawFilename: string,
  declaredMime: string,
): ValidatedQuestionnaireFile | QuestionnaireFileValidationFailure {
  if (bytes.byteLength === 0) {
    return { ok: false, code: "QUESTIONNAIRE_EMPTY" };
  }
  if (bytes.byteLength > MAX_QUESTIONNAIRE_FILE_BYTES) {
    return { ok: false, code: "QUESTIONNAIRE_TOO_LARGE" };
  }

  const sanitizedFilename = sanitizeQuestionnaireFilename(rawFilename);
  if (sanitizedFilename === "" || sanitizedFilename === "questionnaire") {
    return { ok: false, code: "FILENAME_INVALID" };
  }

  if (!(ALLOWED_QUESTIONNAIRE_MIME_TYPES as readonly string[]).includes(declaredMime)) {
    return { ok: false, code: "QUESTIONNAIRE_TYPE_UNSUPPORTED" };
  }

  const format = formatForExtension(sanitizedFilename);
  if (format === null) {
    return { ok: false, code: "QUESTIONNAIRE_TYPE_UNSUPPORTED" };
  }

  // Content must agree with the extension in BOTH directions: an xlsx without
  // ZIP magic is mislabeled text; a csv with ZIP magic is a renamed workbook.
  if (format === "xlsx") {
    if (!startsWithZipMagic(bytes)) {
      return { ok: false, code: "EXTENSION_MISMATCH" };
    }
  } else {
    if (startsWithZipMagic(bytes)) {
      return { ok: false, code: "EXTENSION_MISMATCH" };
    }
    const text = isSupportedCsvText(bytes);
    if (text === "binary") {
      return { ok: false, code: "EXTENSION_MISMATCH" };
    }
    if (text === "encoding") {
      return { ok: false, code: "ENCODING_UNSUPPORTED" };
    }
  }

  const declaredFormat = declaredMime === "text/csv" ? "csv" : "xlsx";
  if (declaredFormat !== format) {
    return { ok: false, code: "EXTENSION_MISMATCH" };
  }

  return {
    ok: true,
    format,
    mime: mimeForFormat(format),
    sanitizedFilename,
    byteSize: bytes.byteLength,
    checksumSha256: sha256Hex(bytes),
  };
}
