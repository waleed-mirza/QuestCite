import { decodeUtf8Text } from "@/lib/files/validate";

/**
 * TXT/Markdown extraction. Bytes were already UTF-8-validated by
 * validateDocumentFile; this stays defensive anyway so a future caller can
 * never turn a decode failure into garbage chunks.
 */
export function extractTextBytes(bytes: Uint8Array): string {
  const decoded = decodeUtf8Text(bytes);
  if (!decoded.ok) {
    throw new Error("ENCODING_UNSUPPORTED");
  }
  return decoded.text;
}
