/**
 * ZIP central-directory safety scan for workbook uploads (plan §9 limits:
 * "No executable files, archives, .doc, .xls, .xlsm, encrypted files").
 *
 * An .xlsx is a ZIP package; macro-enabled (.xlsm) and encrypted workbooks
 * are the same container plus specific entries, and extension checks alone
 * cannot catch a renamed .xlsm. This scanner reads the ZIP central directory
 * (no dependencies, no inflation) and rejects:
 * - `vbaProject.bin`                → macro project (WORKBOOK_MACROS_UNSUPPORTED)
 * - `EncryptedPackage`/`EncryptionInfo` → OOXML agile encryption (WORKBOOK_ENCRYPTED)
 *
 * Pure and client-safe; used by the upload route BEFORE any parse attempt.
 * A buffer that is not a ZIP at all scans clean here — the xlsx parser is
 * the one that fails on it (WORKBOOK_PARSE_FAILED), so error codes stay
 * truthful about what each layer actually validated.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_MIN_LENGTH = 22;
/** EOCD comment is ≤ 65535 bytes; scan back just far enough for it. */
const EOCD_MAX_SCAN = EOCD_MIN_LENGTH + 65535;

/** Lowercase: entry names are normalized with toLowerCase() before matching. */
const MACRO_ENTRY_SUFFIX = "vbaproject.bin";
const ENCRYPTED_ENTRY_NAMES = new Set(["encryptedpackage", "encryptioninfo"]);

export type ZipSafetyResult = { ok: true } | { ok: false; code: "WORKBOOK_MACROS_UNSUPPORTED" | "WORKBOOK_ENCRYPTED" };

export function scanWorkbookZip(bytes: Uint8Array): ZipSafetyResult {
  const eocdOffset = findEocd(bytes);
  if (eocdOffset === null) {
    return { ok: true };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);

  for (let index = 0; index < entryCount; index += 1) {
    // A truncated/corrupt directory ends the scan; the parser owns that error.
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      return { ok: true };
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    if (nameStart + nameLength > bytes.byteLength) {
      return { ok: true };
    }
    const name = new TextDecoder("latin1")
      .decode(bytes.subarray(nameStart, nameStart + nameLength))
      .toLowerCase();

    if (name.endsWith(MACRO_ENTRY_SUFFIX)) {
      return { ok: false, code: "WORKBOOK_MACROS_UNSUPPORTED" };
    }
    if (ENCRYPTED_ENTRY_NAMES.has(name)) {
      return { ok: false, code: "WORKBOOK_ENCRYPTED" };
    }

    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return { ok: true };
}

function findEocd(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lastReadable = bytes.byteLength - EOCD_MIN_LENGTH;
  if (lastReadable < 0) {
    return null;
  }
  const lowest = Math.max(0, bytes.byteLength - EOCD_MAX_SCAN);
  for (let offset = lastReadable; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return null;
}
