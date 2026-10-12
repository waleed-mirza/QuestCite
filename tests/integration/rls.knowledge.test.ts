/**
 * Knowledge-base RLS matrix (plan §W3 gate): Org B cannot read, mutate, or
 * even INFER that Org A's documents, versions, chunks, or entries exist — and
 * the vector RPC refuses non-members outright. Runs against the linked
 * hosted project through real anon/authenticated clients (D016).
 */

import { afterAll, beforeAll, describe, it } from "vitest";

import { expectError, expectErrorWithCode, expectNoRows, expectOk, expectRows } from "./helpers/assert";
import {
  cleanupStorage,
  fakeEmbedding,
  provisionChunk,
  provisionDocumentWithReadyVersion,
} from "./helpers/documents";
import {
  addMember,
  createOrgAs,
  createTestUser,
  disposeAll,
  signInAs,
  type TestUser,
} from "./helpers/fixtures";

let orgA = "";
let orgB = "";
let ownerA!: TestUser;
let reviewerA!: TestUser;
let ownerB!: TestUser;
let ownerAClient!: Awaited<ReturnType<typeof signInAs>>;
let reviewerAClient!: Awaited<ReturnType<typeof signInAs>>;
let viewerAClient!: Awaited<ReturnType<typeof signInAs>>;
let ownerBClient!: Awaited<ReturnType<typeof signInAs>>;
let anon!: Awaited<ReturnType<typeof import("./helpers/clients").getAnonClient>>;

beforeAll(async () => {
  const { getAnonClient } = await import("./helpers/clients");
  anon = getAnonClient();

  ownerA = await createTestUser("kb-owner-a", { fullName: "KB Owner A" });
  reviewerA = await createTestUser("kb-reviewer-a");
  const aViewer = await createTestUser("kb-viewer-a");
  ownerB = await createTestUser("kb-owner-b");

  ownerAClient = await signInAs(ownerA);
  reviewerAClient = await signInAs(reviewerA);
  viewerAClient = await signInAs(aViewer);
  ownerBClient = await signInAs(ownerB);

  orgA = await createOrgAs(ownerAClient, "KB Org A", `kb-org-a-${Date.now().toString(36)}`);
  orgB = await createOrgAs(ownerBClient, "KB Org B", `kb-org-b-${Date.now().toString(36)}`);
  await addMember(orgA, reviewerA.userId, "reviewer");
  await addMember(orgA, aViewer.userId, "viewer");
});

afterAll(async () => {
  await cleanupStorage();
  await disposeAll();
});

describe("documents / versions / chunks / entries — cross-tenant reads", () => {
  let docA = "";

  beforeAll(async () => {
    const provisioned = await provisionDocumentWithReadyVersion({ organizationId: orgA, title: "Org A Secret Policy" });
    docA = provisioned.documentId;
    await provisionChunk({
      organizationId: orgA,
      documentId: provisioned.documentId,
      versionId: provisioned.versionId,
      sequence: 0,
      content: "Org A confidential control: ZEBRA-7741",
      seed: 1,
    });
  });

  it("members of A read their own document, versions, and chunks", async () => {
    expectRows(await ownerAClient.from("documents").select("*").eq("id", docA), "A reads own doc");
    expectRows(await reviewerAClient.from("document_versions").select("*").eq("document_id", docA), "reviewer reads versions");
    expectRows(await viewerAClient.from("document_chunks").select("*").eq("document_id", docA), "viewer reads chunks");
  });

  it("Org B, and anonymous, see nothing of Org A (no existence leak)", async () => {
    expectNoRows(await ownerBClient.from("documents").select("*").eq("id", docA), "B cannot read A doc");
    expectNoRows(await ownerBClient.from("document_versions").select("*").eq("document_id", docA), "B cannot read versions");
    expectNoRows(await ownerBClient.from("document_chunks").select("*").eq("document_id", docA), "B cannot read chunks");
    expectNoRows(await anon.from("documents").select("*").eq("id", docA), "anon cannot read doc");
    expectNoRows(await ownerBClient.from("knowledge_entry_versions").select("*"), "B cannot read A entry versions");
  });

  it("an explicit probe by id returns the same empty shape as a missing id", async () => {
    const missingId = crypto.randomUUID();
    const probe = await ownerBClient.from("documents").select("id").eq("id", docA);
    const missing = await ownerBClient.from("documents").select("id").eq("id", missingId);
    expectNoRows(probe, "probe existing A doc from B");
    expectNoRows(missing, "probe truly-missing id from B");
  });
});

describe("documents — writes per the permission matrix", () => {
  it("viewer and reviewer cannot insert or update documents", async () => {
    expectError(
      await viewerAClient.from("documents").insert({ organization_id: orgA, title: "Nope" }),
      "viewer insert doc",
    );
    expectError(
      await reviewerAClient.from("documents").insert({ organization_id: orgA, title: "Nope" }),
      "reviewer insert doc",
    );
    const provisioned = await provisionDocumentWithReadyVersion({ organizationId: orgA });
    // UPDATE denials are SILENT (RLS USING filters the row out, 0 rows
    // affected) — assert zero affected rows via .select(), so a policy that
    // starts allowing the write fails loudly.
    expectNoRows(
      await reviewerAClient.from("documents").update({ title: "Hijack" }).eq("id", provisioned.documentId).select("id"),
      "reviewer update doc",
    );
    expectNoRows(
      await viewerAClient.from("documents").update({ state: "archived" }).eq("id", provisioned.documentId).select("id"),
      "viewer update doc",
    );
  });

  it("viewer cannot write versions or chunks", async () => {
    const provisioned = await provisionDocumentWithReadyVersion({ organizationId: orgA });
    expectError(
      await viewerAClient.from("document_versions").insert({
        document_id: provisioned.documentId,
        organization_id: orgA,
        version_number: 2,
        storage_path: `${orgA}/${provisioned.documentId}/${crypto.randomUUID()}/x.pdf`,
        mime_type: "application/pdf",
        byte_size: 10,
        checksum_sha256: "c".repeat(64),
      }),
      "viewer insert version",
    );
    expectError(
      await viewerAClient.from("document_chunks").insert({
        organization_id: orgA,
        document_id: provisioned.documentId,
        version_id: provisioned.versionId,
        sequence: 99,
        content: "viewer chunk",
        token_count: 3,
        checksum_sha256: "d".repeat(64),
      }),
      "viewer insert chunk",
    );
  });

  it("chunk inserts fail when the version does not belong to the same org/document", async () => {
    const orgADoc = await provisionDocumentWithReadyVersion({ organizationId: orgA });
    const orgBDoc = await provisionDocumentWithReadyVersion({ organizationId: orgB });
    // A's owner tries to insert a chunk pairing A's org with B's version.
    expectError(
      await ownerAClient.from("document_chunks").insert({
        organization_id: orgA,
        document_id: orgBDoc.documentId,
        version_id: orgBDoc.versionId,
        sequence: 5,
        content: "mismatched",
        token_count: 2,
        checksum_sha256: "e".repeat(64),
      }),
      "mismatched org/version chunk insert",
    );
    // Cross-org pair: A's org id + B's version id — must also fail.
    expectError(
      await ownerAClient.from("document_chunks").insert({
        organization_id: orgA,
        document_id: orgADoc.documentId,
        version_id: orgBDoc.versionId,
        sequence: 6,
        content: "cross",
        token_count: 2,
        checksum_sha256: "f".repeat(64),
      }),
      "cross-org version chunk insert",
    );
  });

  it("archiving and deleting are owner/admin-only; delete cascades versions and chunks", async () => {
    const provisioned = await provisionDocumentWithReadyVersion({ organizationId: orgA });
    // DELETE denials are silent too (USING filters) — assert zero rows.
    expectNoRows(
      await viewerAClient.from("documents").delete().eq("id", provisioned.documentId).select("id"),
      "viewer delete doc",
    );
    expectOk(
      await ownerAClient.from("documents").update({ state: "archived" }).eq("id", provisioned.documentId),
      "owner archives",
    );
    expectOk(
      await ownerAClient.from("documents").delete().eq("id", provisioned.documentId),
      "owner deletes",
    );
    expectNoRows(await ownerAClient.from("document_versions").select("*").eq("id", provisioned.versionId), "version cascaded");
  });
});

describe("document_versions immutability", () => {
  it("processing columns may change; content columns never", async () => {
    const provisioned = await provisionDocumentWithReadyVersion({ organizationId: orgA });

    expectOk(
      await ownerAClient
        .from("document_versions")
        .update({ processing_state: "failed", processing_error_code: "PARSER_FAILED", processing_attempts: 1 })
        .eq("id", provisioned.versionId),
      "processing columns update",
    );

    // Content columns are immutable TWICE over: they are outside the column
    // grant (permission denied before RLS even runs), and the
    // protect_document_version_content trigger backstops any definer-context
    // write. From a client, the grant-level denial is the observable shape.
    expectError(
      await ownerAClient.from("document_versions").update({ byte_size: 2 }).eq("id", provisioned.versionId),
      "byte_size rewrite",
    );
    expectError(
      await ownerAClient.from("document_versions").update({ checksum_sha256: "0".repeat(64) }).eq("id", provisioned.versionId),
      "checksum rewrite",
    );
    expectError(
      await ownerAClient.from("document_versions").update({ storage_path: "somewhere/else" }).eq("id", provisioned.versionId),
      "storage_path rewrite",
    );
    // Reviewer cannot touch even the processing columns (policy, silent).
    expectNoRows(
      await reviewerAClient
        .from("document_versions")
        .update({ processing_state: "ready" })
        .eq("id", provisioned.versionId)
        .select("id"),
      "reviewer version update",
    );
  });

  it("anonymous and cross-org users cannot update versions at all", async () => {
    const provisioned = await provisionDocumentWithReadyVersion({ organizationId: orgA });
    expectNoRows(
      await ownerBClient.from("document_versions").update({ processing_state: "ready" }).eq("id", provisioned.versionId).select("id"),
      "B cannot update A version",
    );
    expectNoRows(
      await anon.from("document_versions").update({ processing_state: "ready" }).eq("id", provisioned.versionId).select("id"),
      "anon cannot update version",
    );
  });
});

describe("create_document_upload RPC", () => {
  it("owner/admin create documents with server-built paths", async () => {
    const { data, error } = await ownerAClient.rpc("create_document_upload", {
      p_organization_id: orgA,
      p_title: "RPC Created Policy",
      p_category: "policies",
      p_tags: ["soc2"],
      p_review_by: "2026-12-31",
      p_filename: "policy.pdf",
      p_mime_type: "application/pdf",
      p_byte_size: 1234,
      p_checksum_sha256: "a".repeat(64),
    });
    expectOk({ data, error }, "owner creates via RPC");
    const rows = data as Array<{ document_id: string; version_id: string; storage_path: string }> | null;
    const result = rows?.[0];
    if (!result?.storage_path?.startsWith(`${orgA}/`)) {
      throw new Error(`storage path not org-prefixed: ${result?.storage_path}`);
    }

    // Viewer adds a version to the same document — must fail.
    expectErrorWithCode(
      await viewerAClient.rpc("create_document_upload", {
        p_organization_id: orgA,
        p_title: "x",
        p_category: "general",
        p_tags: [],
        p_review_by: "2026-12-31",
        p_filename: "x.pdf",
        p_mime_type: "application/pdf",
        p_byte_size: 1,
        p_checksum_sha256: "a".repeat(64),
        p_document_id: result.document_id,
      }),
      "FORBIDDEN",
      "viewer version attempt",
    );

    // Owner adds a version to B's document — same code as a missing document.
    expectErrorWithCode(
      await ownerBClient.rpc("create_document_upload", {
        p_organization_id: orgB,
        p_title: "x",
        p_category: "general",
        p_tags: [],
        p_review_by: "2026-12-31",
        p_filename: "x.pdf",
        p_mime_type: "application/pdf",
        p_byte_size: 1,
        p_checksum_sha256: "a".repeat(64),
        p_document_id: result.document_id,
      }),
      "DOCUMENT_NOT_FOUND",
      "cross-org version attempt",
    );
  });

  it("rejects bad input with stable codes", async () => {
    const base = {
      p_organization_id: orgA,
      p_title: "Bad",
      p_category: "general",
      p_tags: [],
      p_review_by: "2026-12-31",
    };
    expectErrorWithCode(
      await ownerAClient.rpc("create_document_upload", { ...base, p_filename: "x.pdf", p_mime_type: "application/zip", p_byte_size: 10, p_checksum_sha256: "a".repeat(64) }),
      "DOCUMENT_TYPE_UNSUPPORTED",
      "bad mime",
    );
    expectErrorWithCode(
      await ownerAClient.rpc("create_document_upload", { ...base, p_filename: "x.pdf", p_mime_type: "application/pdf", p_byte_size: 11_000_000, p_checksum_sha256: "a".repeat(64) }),
      "DOCUMENT_TOO_LARGE",
      "oversize",
    );
    expectErrorWithCode(
      await ownerAClient.rpc("create_document_upload", { ...base, p_filename: "x.pdf", p_mime_type: "application/pdf", p_byte_size: 0, p_checksum_sha256: "a".repeat(64) }),
      "DOCUMENT_EMPTY",
      "empty",
    );
    expectErrorWithCode(
      await ownerAClient.rpc("create_document_upload", { ...base, p_filename: "../evil", p_mime_type: "application/pdf", p_byte_size: 1, p_checksum_sha256: "a".repeat(64) }),
      "DOCUMENT_INPUT_INVALID",
      "path traversal filename",
    );
    expectErrorWithCode(
      await ownerAClient.rpc("create_document_upload", { ...base, p_filename: "x.pdf", p_mime_type: "application/pdf", p_byte_size: 1, p_checksum_sha256: "not-hex" }),
      "DOCUMENT_INPUT_INVALID",
      "bad checksum",
    );
  });

  it("anonymous callers are rejected (grant layer denies before the RPC runs)", async () => {
    // anon holds no EXECUTE grant on the RPC, so the denial surfaces as a
    // permission error rather than the function's own AUTH_REQUIRED — both
    // are valid rejections; the grant layer is simply the first gate.
    expectError(
      await anon.rpc("create_document_upload", {
        p_organization_id: orgA,
        p_title: "x",
        p_category: "general",
        p_tags: [],
        p_review_by: "2026-12-31",
        p_filename: "x.pdf",
        p_mime_type: "application/pdf",
        p_byte_size: 1,
        p_checksum_sha256: "a".repeat(64),
      }),
      "anon RPC",
    );
  });
});

describe("save_knowledge_entry RPC + immutable version history", () => {
  let entryId = "";

  it("creates an entry and its v1 atomically; version rows are select-only", async () => {
    const { data, error } = await ownerAClient.rpc("save_knowledge_entry", {
      p_organization_id: orgA,
      p_question: "Is data encrypted at rest?",
      p_answer: "Yes, AES-256 for all storage.",
      p_category: "encryption",
      p_tags: ["soc2"],
      p_review_state: "approved",
      p_review_by: "2026-12-31",
    });
    expectOk({ data, error }, "entry created");
    entryId = String(data);

    expectRows(await ownerAClient.from("knowledge_entries").select("*").eq("id", entryId), "A reads entry");
    expectRows(await ownerAClient.from("knowledge_entry_versions").select("*").eq("entry_id", entryId), "v1 history");
    expectError(
      await ownerAClient.from("knowledge_entry_versions").insert({
        organization_id: orgA,
        entry_id: entryId,
        version_number: 99,
        question: "forged",
        answer: "forged",
        category: "x",
        tags: [],
        review_state: "approved",
      }),
      "direct version insert denied",
    );
  });

  it("editing appends a new immutable version with an incremented number", async () => {
    const { data, error } = await ownerAClient.rpc("save_knowledge_entry", {
      p_organization_id: orgA,
      p_question: "Is data encrypted at rest?",
      p_answer: "Yes — AES-256 at rest, TLS 1.3 in transit.",
      p_category: "encryption",
      p_tags: ["soc2", "product"],
      p_review_state: "needs_review",
      p_review_by: "2026-12-31",
      p_entry_id: entryId,
    });
    expectOk({ data, error }, "entry updated");
    const versions = await ownerAClient
      .from("knowledge_entry_versions")
      .select("version_number, answer")
      .eq("entry_id", entryId)
      .order("version_number");
    expectRows(versions, "two versions");
    const rows = versions.data as Array<{ version_number: number; answer: string }>;
    if (rows.length !== 2 || rows[0]?.answer === rows[1]?.answer) {
      throw new Error(`expected 2 distinct versions, got ${JSON.stringify(rows).slice(0, 200)}`);
    }
  });

  it("Org B cannot read, edit, or probe A's entries", async () => {
    expectNoRows(await ownerBClient.from("knowledge_entries").select("*").eq("id", entryId), "B cannot read entry");
    expectErrorWithCode(
      await ownerBClient.rpc("save_knowledge_entry", {
        p_organization_id: orgB,
        p_question: "q",
        p_answer: "a",
        p_category: "general",
        p_tags: [],
        p_review_state: "draft",
        p_review_by: "2026-12-31",
        p_entry_id: entryId,
      }),
      "ENTRY_NOT_FOUND",
      "B cannot edit A entry",
    );
  });
});

describe("reset_document_version_for_retry RPC", () => {
  it("resets failed versions, wipes chunks, and enforces the cap", async () => {
    const provisioned = await provisionDocumentWithReadyVersion({ organizationId: orgA });
    await provisionChunk({
      organizationId: orgA,
      documentId: provisioned.documentId,
      versionId: provisioned.versionId,
      sequence: 0,
      content: "stale chunk",
      seed: 2,
    });
    expectOk(
      await ownerAClient
        .from("document_versions")
        .update({ processing_state: "failed", processing_error_code: "EMBEDDING_UNAVAILABLE", processing_attempts: 0 })
        .eq("id", provisioned.versionId),
      "mark failed",
    );

    expectOk(
      await ownerAClient.rpc("reset_document_version_for_retry", {
        p_organization_id: orgA,
        p_document_id: provisioned.documentId,
        p_version_id: provisioned.versionId,
      }),
      "retry reset",
    );
    expectNoRows(
      await ownerAClient.from("document_chunks").select("*").eq("version_id", provisioned.versionId),
      "chunks wiped for retry",
    );

    // Non-failed state → RETRY_NOT_ALLOWED.
    expectErrorWithCode(
      await ownerAClient.rpc("reset_document_version_for_retry", {
        p_organization_id: orgA,
        p_document_id: provisioned.documentId,
        p_version_id: provisioned.versionId,
      }),
      "RETRY_NOT_ALLOWED",
      "retry on pending",
    );

    // Drive to the cap: 3 attempts total (one consumed above).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expectOk(
        await ownerAClient
          .from("document_versions")
          .update({ processing_state: "failed", processing_error_code: "PARSER_FAILED" })
          .eq("id", provisioned.versionId),
        `mark failed ${attempt}`,
      );
      const retryResult = await ownerAClient.rpc("reset_document_version_for_retry", {
        p_organization_id: orgA,
        p_document_id: provisioned.documentId,
        p_version_id: provisioned.versionId,
      });
      if (attempt < 2) {
        expectOk(retryResult, `retry ${attempt}`);
      } else {
        expectErrorWithCode(retryResult, "RETRY_LIMIT_REACHED", "retry at cap");
      }
    }
  });

  it("Org B cannot reset A's versions (same code as missing)", async () => {
    const provisioned = await provisionDocumentWithReadyVersion({ organizationId: orgA });
    expectOk(
      await ownerAClient
        .from("document_versions")
        .update({ processing_state: "failed", processing_error_code: "PARSER_FAILED" })
        .eq("id", provisioned.versionId),
      "mark failed",
    );
    expectErrorWithCode(
      await ownerBClient.rpc("reset_document_version_for_retry", {
        p_organization_id: orgB,
        p_document_id: provisioned.documentId,
        p_version_id: provisioned.versionId,
      }),
      "DOCUMENT_NOT_FOUND",
      "B resets A version",
    );
  });
});

describe("match_org_evidence — cross-tenant vector isolation", () => {
  beforeAll(async () => {
    // Org A: ONE document with an OLD version (v1, distinct marker) and a
    // CURRENT version (v2). Only the current version may ever be searched.
    const doc = await provisionDocumentWithReadyVersion({
      organizationId: orgA,
      title: "Vector Doc A1",
      versionNumber: 1,
    });
    await provisionChunk({
      organizationId: orgA,
      documentId: doc.documentId,
      versionId: doc.versionId,
      sequence: 0,
      content: "Old passphrase chunk OLD-A1-9999.",
      seed: 10,
    });
    const current = await provisionDocumentWithReadyVersion({
      organizationId: orgA,
      title: "Vector Doc A1",
      versionNumber: 2,
      documentId: doc.documentId,
    });
    await provisionChunk({
      organizationId: orgA,
      documentId: current.documentId,
      versionId: current.versionId,
      sequence: 0,
      content: "The secret passphrase is CURR-A1-7741.",
      seed: 10,
    });
    // B: its own document with markers that share NO tokens with A's.
    const bDoc = await provisionDocumentWithReadyVersion({ organizationId: orgB, title: "Vector Doc B1" });
    await provisionChunk({
      organizationId: orgB,
      documentId: bDoc.documentId,
      versionId: bDoc.versionId,
      sequence: 0,
      content: "Org B content B-TOKEN-3691.",
      seed: 10,
    });
  });

  it("returns only Org A's current-version chunks to A's member", async () => {
    const result = await ownerAClient.rpc("match_org_evidence", {
      p_organization_id: orgA,
      p_query_embedding: fakeEmbedding(42),
      p_query_text: "passphrase",
      p_match_count: 8,
    });
    expectOk({ data: result.data, error: result.error }, "A searches");
    const rows = result.data as Array<{ content: string }>;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("expected at least one chunk for org A");
    }
    for (const row of rows) {
      if (row.content.includes("OLD-A1-9999")) {
        throw new Error("old version chunk leaked into search results");
      }
      if (row.content.includes("B-TOKEN-3691")) {
        throw new Error("cross-tenant chunk leaked into search results");
      }
    }
    if (!rows.some((row) => row.content.includes("CURR-A1-7741"))) {
      throw new Error("current version chunk missing from search results");
    }
  });

  it("B's member searching B sees only B content; probing A's org id is FORBIDDEN", async () => {
    const own = await ownerBClient.rpc("match_org_evidence", {
      p_organization_id: orgB,
      p_query_embedding: fakeEmbedding(42),
      p_query_text: "content",
      p_match_count: 8,
    });
    expectOk({ data: own.data, error: own.error }, "B searches own");
    for (const row of (own.data as Array<{ content: string }>) ?? []) {
      if (row.content.includes("A1-") || row.content.includes("passphrase")) {
        throw new Error("Org A content leaked into Org B results");
      }
    }

    expectErrorWithCode(
      await ownerBClient.rpc("match_org_evidence", {
        p_organization_id: orgA,
        p_query_embedding: fakeEmbedding(42),
        p_query_text: "ZEBRA",
        p_match_count: 8,
      }),
      "FORBIDDEN",
      "B probes A org",
    );
    // anon holds no EXECUTE grant on the RPC — denied at the grant layer.
    expectError(
      await anon.rpc("match_org_evidence", {
        p_organization_id: orgA,
        p_query_embedding: fakeEmbedding(42),
        p_query_text: "passphrase",
        p_match_count: 8,
      }),
      "anon probes A org",
    );
  });

  it("rejects out-of-bounds match counts", async () => {
    expectErrorWithCode(
      await ownerAClient.rpc("match_org_evidence", {
        p_organization_id: orgA,
        p_query_embedding: fakeEmbedding(42),
        p_query_text: "ZEBRA",
        p_match_count: 0,
      }),
      "EVIDENCE_QUERY_INVALID",
      "zero count",
    );
    expectErrorWithCode(
      await ownerAClient.rpc("match_org_evidence", {
        p_organization_id: orgA,
        p_query_embedding: fakeEmbedding(42),
        p_query_text: "ZEBRA",
        p_match_count: 51,
      }),
      "EVIDENCE_QUERY_INVALID",
      "oversized count",
    );
  });
});
