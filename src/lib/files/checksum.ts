import { createHash } from "node:crypto";

/**
 * Content checksums (plan §9). SHA-256 hex is the canonical identity of an
 * uploaded file and of every extracted chunk: it drives the upload-integrity
 * check, embedding cache reuse, and dedup within a batch.
 */

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
