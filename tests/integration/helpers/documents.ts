import { getAdminClient } from "./clients";

/**
 * Fixture helpers for knowledge-document tests (plan §W3).
 *
 * Provisions rows with the service-role client (fixture setup only — the
 * assertions themselves always run through anon/authenticated clients so RLS
 * is what is under test). Vector(1536) values are FABRICATED literals: the
 * isolation properties of match_org_evidence do not depend on real embeddings.
 */

const storagePaths: string[] = [];

export function trackStoragePath(path: string): void {
  storagePaths.push(path);
}

/** Removes every storage object created under test (org delete does not cascade storage). */
export async function cleanupStorage(): Promise<void> {
  if (storagePaths.length === 0) {
    return;
  }
  const admin = getAdminClient();
  await admin.storage.from("documents").remove([...storagePaths]);
  storagePaths.splice(0);
}

export type ProvisionedDocument = {
  documentId: string;
  versionId: string;
  storagePath: string;
};

/** Inserts a document + one ready version directly (service role).
 *  Pass `documentId` to add a version to an EXISTING document (new uuids are
 *  generated when omitted). */
export async function provisionDocumentWithReadyVersion(input: {
  organizationId: string;
  title?: string;
  versionNumber?: number;
  documentId?: string;
}): Promise<ProvisionedDocument> {
  const admin = getAdminClient();
  const documentId = input.documentId ?? crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const storagePath = `${input.organizationId}/${documentId}/${versionId}/fixture.pdf`;

  if (input.documentId === undefined) {
    const { error: docError } = await admin.from("documents").insert({
      id: documentId,
      organization_id: input.organizationId,
      title: input.title ?? "Fixture document",
      category: "general",
      tags: [],
      state: "active",
    });
    if (docError !== null) {
      throw new Error(`provisionDocument(document) failed: ${docError.message}`);
    }
  }

  const { error: versionError } = await admin.from("document_versions").insert({
    id: versionId,
    document_id: documentId,
    organization_id: input.organizationId,
    version_number: input.versionNumber ?? 1,
    storage_path: storagePath,
    mime_type: "application/pdf",
    byte_size: 1024,
    checksum_sha256: "a".repeat(64),
    parser_version: "1",
    processing_state: "ready",
    page_count: 1,
    char_count: 100,
  });
  if (versionError !== null) {
    throw new Error(`provisionDocument(version) failed: ${versionError.message}`);
  }

  trackStoragePath(storagePath);
  return { documentId, versionId, storagePath };
}

/** Deterministic pseudo-embedding so similar/dissimilar vectors are controllable. */
export function fakeEmbedding(seed: number): string {
  const values = Array.from({ length: 1536 }, (_, i) => {
    const x = Math.sin(seed * 1000 + i) / 2;
    return x.toFixed(6);
  });
  return `[${values.join(",")}]`;
}

/** Inserts a chunk with a fabricated embedding (service role). */
export async function provisionChunk(input: {
  organizationId: string;
  documentId: string;
  versionId: string;
  sequence: number;
  content: string;
  seed: number;
}): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("document_chunks")
    .insert({
      organization_id: input.organizationId,
      document_id: input.documentId,
      version_id: input.versionId,
      sequence: input.sequence,
      section: "",
      content: input.content,
      token_count: 10,
      checksum_sha256: "b".repeat(64),
      embedding: fakeEmbedding(input.seed),
    })
    .select("id")
    .single();
  if (error !== null || data === null) {
    throw new Error(`provisionChunk failed: ${error?.message ?? "no id"}`);
  }
  return data.id;
}
