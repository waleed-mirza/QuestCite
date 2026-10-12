import "server-only";

import type { DocumentKind } from "@/config/ingestion";
import { getEmbeddingProvider } from "@/lib/ai/embeddings";
import { sha256Hex } from "@/lib/files/checksum";
import { chunkText, normalizeExtractedText } from "@/lib/files/chunking";
import { parseDocument, ParserError } from "@/lib/files/parsers";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Ingestion pipeline (plan §9): storage download → checksum verification →
 * parse → normalize → chunk → batch embeddings → document_chunks → `ready`.
 *
 * Runs entirely on one request with the USER's client, so every write below
 * passes RLS as the acting member (defense in depth: the route handler also
 * re-checks role). Files are ≤10 MB, so synchronous processing is safe; the
 * retry cap and idempotent chunk wipe live in the database RPCs.
 *
 * Failures ALWAYS end in a version row marked `failed` with a SAFE CONSTANT
 * CODE — never parser output, storage paths, or document content in logs or
 * in the database (plan §16).
 */

export type ProcessingErrorCode =
  | "CHECKSUM_MISMATCH"
  | "PARSER_FAILED"
  | "EMPTY_DOCUMENT"
  | "ENCRYPTED_DOCUMENT"
  | "ENCODING_UNSUPPORTED"
  | "UNSUPPORTED_TYPE"
  | "EMBEDDING_UNAVAILABLE"
  | "EMBEDDING_FAILED"
  | "CHUNK_INSERT_FAILED";

/** Codes where retrying can plausibly succeed (transient or config fixes). */
export const RETRYABLE_CODES: readonly ProcessingErrorCode[] = [
  "CHECKSUM_MISMATCH",
  "PARSER_FAILED",
  "EMBEDDING_UNAVAILABLE",
  "EMBEDDING_FAILED",
  "CHUNK_INSERT_FAILED",
];

export function isRetryable(code: string): boolean {
  return (RETRYABLE_CODES as readonly string[]).includes(code);
}

type VersionRef = {
  documentId: string;
  versionId: string;
  storagePath: string;
  organizationId: string;
  expectedChecksum: string;
  kind: DocumentKind;
};

async function markFailed(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, versionId: string, code: ProcessingErrorCode): Promise<void> {
  const { error } = await supabase
    .from("document_versions")
    .update({
      processing_state: "failed",
      processing_error_code: code,
    })
    .eq("id", versionId);
  if (error !== null) {
    logger.warn("version mark-failed write failed", { code: error.message.slice(0, 60) });
  }
}

/**
 * Runs the pipeline for one pending version. Never throws — every outcome is
 * reflected in the version's processing state; the boolean reports readiness.
 */
export async function processDocumentVersion(ref: VersionRef): Promise<boolean> {
  const supabase = await createSupabaseServerClient();

  try {
    // ---- 1. download + verify integrity (plan §9: checksum validation) ----
    const downloaded = await supabase.storage.from("documents").download(ref.storagePath);
    if (downloaded.error !== null || downloaded.data === null) {
      logger.warn("ingestion storage download failed", { code: downloaded.error?.message.slice(0, 40) ?? "empty" });
      await markFailed(supabase, ref.versionId, "CHECKSUM_MISMATCH");
      return false;
    }
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const actualChecksum = sha256Hex(bytes);
    if (actualChecksum !== ref.expectedChecksum) {
      await markFailed(supabase, ref.versionId, "CHECKSUM_MISMATCH");
      return false;
    }

    // ---- 2. parse (typed safe errors; library messages never surface) ----
    let parsed;
    try {
      parsed = await parseDocument(bytes, ref.kind);
    } catch (error) {
      const code: ProcessingErrorCode =
        error instanceof ParserError ? error.code : "PARSER_FAILED";
      logger.warn("ingestion parse failed", { code, kind: ref.kind });
      await markFailed(supabase, ref.versionId, code);
      return false;
    }

    // ---- 3. normalize + chunk (deterministic → idempotent retries) ----
    const normalized = normalizeExtractedText(parsed.text);
    if (normalized === "") {
      await markFailed(supabase, ref.versionId, "EMPTY_DOCUMENT");
      return false;
    }
    const chunks = chunkText(normalized);
    if (chunks.length === 0) {
      await markFailed(supabase, ref.versionId, "EMPTY_DOCUMENT");
      return false;
    }

    // ---- 4. embeddings (cached by content checksum; batched) ----
    const provider = getEmbeddingProvider();
    if (provider === null) {
      await markFailed(supabase, ref.versionId, "EMBEDDING_UNAVAILABLE");
      return false;
    }
    let embeddings: number[][];
    try {
      embeddings = await provider.embed(chunks.map((chunk) => chunk.content));
    } catch (error) {
      const code = error instanceof Error && error.name === "EmbeddingError" ? "EMBEDDING_FAILED" : "EMBEDDING_FAILED";
      logger.warn("ingestion embedding failed", { code, count: chunks.length });
      await markFailed(supabase, ref.versionId, code);
      return false;
    }
    if (embeddings.length !== chunks.length) {
      await markFailed(supabase, ref.versionId, "EMBEDDING_FAILED");
      return false;
    }

    // ---- 5. persist chunks (single statement; embedding effectively NOT NULL) ----
    const { error: chunkError } = await supabase.from("document_chunks").insert(
      chunks.map((chunk, index) => ({
        organization_id: ref.organizationId,
        document_id: ref.documentId,
        version_id: ref.versionId,
        sequence: chunk.sequence,
        section: chunk.section,
        content: chunk.content,
        token_count: chunk.tokenCount,
        checksum_sha256: chunk.checksumSha256,
        embedding: `[${(embeddings[index] ?? []).join(",")}]`,
      })),
    );
    if (chunkError !== null) {
      logger.warn("ingestion chunk insert failed", { code: chunkError.message.slice(0, 60) });
      await markFailed(supabase, ref.versionId, "CHUNK_INSERT_FAILED");
      return false;
    }

    // ---- 6. ready ----
    const { error: readyError } = await supabase
      .from("document_versions")
      .update({
        processing_state: "ready",
        processing_error_code: null,
        parser_version: parsed.parserVersion,
        page_count: parsed.pageCount,
        char_count: normalized.length,
      })
      .eq("id", ref.versionId);
    if (readyError !== null) {
      logger.warn("ingestion ready write failed", { code: readyError.message.slice(0, 60) });
      return false;
    }
    return true;
  } catch (error) {
    logger.warn("ingestion unexpected failure", { code: error instanceof Error ? error.name : "unknown" });
    await markFailed(supabase, ref.versionId, "PARSER_FAILED");
    return false;
  }
}
