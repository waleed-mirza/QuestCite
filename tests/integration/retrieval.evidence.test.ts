/**
 * Evidence retrieval service (plan §10) against the real hybrid search RPC:
 * the evidence set contains only in-org, current-version, approved evidence;
 * the preference signals (approved answer, staleness, tags) surface as
 * transparent flags; retrieval degrades safely to text-only when no
 * embedding provider is configured — AI is force-disabled for this suite (see
 * beforeAll: the hermetic budget contract keeps ordinary integration runs
 * live-call-free even on a machine whose .env.local carries a real key).
 * Cross-tenant isolation of the underlying RPC is covered by
 * rls.knowledge.test.ts; here it is asserted once THROUGH the service.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetServerEnvCache } from "@/lib/env";

import { retrieveEvidenceForQuestion } from "@/server/services/retrieval";

import { getAdminClient } from "./helpers/clients";
import { provisionChunk, provisionDocumentWithReadyVersion } from "./helpers/documents";
import {
  createOrgAs,
  createTestUser,
  disposeAll,
  signInAs,
  type TestUser,
} from "./helpers/fixtures";

let orgA = "";
let orgB = "";
let ownerA!: TestUser;
let ownerB!: TestUser;
let ownerAClient!: Awaited<ReturnType<typeof signInAs>>;
let ownerBClient!: Awaited<ReturnType<typeof signInAs>>;
let entryApprovedId = "";
let entryDraftId = "";
// `string | null` elements so a chunk citation with a null documentId fails
// the toContain assertions below instead of typechecking away.
const orgADocumentIds: Array<string | null> = [];
const orgBDocumentIds: Array<string | null> = [];

// Prior AI_ENABLED value — restored in afterAll so the shared test process
// (isolate:false) never leaks the forced-off state into later files.
let previousAiEnabled: string | undefined;

beforeAll(async () => {
  // Hermetic budget contract (memory/budget-tracking.md): ordinary
  // integration tests never make live provider calls. Retrieval runs
  // text-only here even on a developer machine with a configured key; the
  // live embedding path is covered by the explicitly budget-gated
  // embeddings-live suite, never by this file.
  previousAiEnabled = process.env.AI_ENABLED;
  process.env.AI_ENABLED = "false";
  resetServerEnvCache();

  const admin = getAdminClient();

  ownerA = await createTestUser("ret-owner-a", { fullName: "Retrieval Owner A" });
  ownerB = await createTestUser("ret-owner-b", { fullName: "Retrieval Owner B" });
  ownerAClient = await signInAs(ownerA);
  ownerBClient = await signInAs(ownerB);
  orgA = await createOrgAs(ownerAClient, "Retrieval Org A", `ret-org-a-${Date.now().toString(36)}`);
  orgB = await createOrgAs(ownerBClient, "Retrieval Org B", `ret-org-b-${Date.now().toString(36)}`);

  // Org A evidence: one fresh doc (tagged), one stale doc, one approved
  // entry, one draft entry. Org B gets a decoy that must never surface.
  const freshDoc = await provisionDocumentWithReadyVersion({
    organizationId: orgA,
    title: "Security Whitepaper",
  });
  orgADocumentIds.push(freshDoc.documentId);
  const freshDocUpdate = await admin
    .from("documents")
    .update({ tags: ["eu", "iso27001"], review_by: "2099-01-01" })
    .eq("id", freshDoc.documentId);
  if (freshDocUpdate.error !== null) throw new Error(freshDocUpdate.error.message);
  await provisionChunk({
    organizationId: orgA,
    documentId: freshDoc.documentId,
    versionId: freshDoc.versionId,
    sequence: 0,
    content: "All customer data is encrypted at rest with AES-256 and keys are managed in an HSM.",
    seed: 11,
  });

  const staleDoc = await provisionDocumentWithReadyVersion({
    organizationId: orgA,
    title: "Old Retention Memo",
  });
  orgADocumentIds.push(staleDoc.documentId);
  const staleDocUpdate = await admin
    .from("documents")
    .update({ review_by: "2020-01-01" })
    .eq("id", staleDoc.documentId);
  if (staleDocUpdate.error !== null) throw new Error(staleDocUpdate.error.message);
  await provisionChunk({
    organizationId: orgA,
    documentId: staleDoc.documentId,
    versionId: staleDoc.versionId,
    sequence: 0,
    content: "Data retention: logs are kept no longer than twelve months according to the 2020 policy.",
    seed: 12,
  });

  entryApprovedId = crypto.randomUUID();
  const approved = await admin.from("knowledge_entries").insert({
    id: entryApprovedId,
    organization_id: orgA,
    question: "How long do you retain log data?",
    answer: "Security logs are retained for twelve months, then automatically deleted.",
    category: "retention",
    tags: ["eu"],
    review_state: "approved",
  });
  if (approved.error !== null) throw new Error(approved.error.message);

  entryDraftId = crypto.randomUUID();
  const draft = await admin.from("knowledge_entries").insert({
    id: entryDraftId,
    organization_id: orgA,
    question: "Draft-only entry about encryption?",
    answer: "This entry is not approved and must never be retrievable evidence.",
    review_state: "draft",
  });
  if (draft.error !== null) throw new Error(draft.error.message);

  const orgBDoc = await provisionDocumentWithReadyVersion({ organizationId: orgB });
  orgBDocumentIds.push(orgBDoc.documentId);
  await provisionChunk({
    organizationId: orgB,
    documentId: orgBDoc.documentId,
    versionId: orgBDoc.versionId,
    sequence: 0,
    content: "Org B decoy: encryption at rest details that must never leak.",
    seed: 13,
  });
});

afterAll(async () => {
  await disposeAll();
  if (previousAiEnabled === undefined) {
    delete process.env.AI_ENABLED;
  } else {
    process.env.AI_ENABLED = previousAiEnabled;
  }
  resetServerEnvCache();
});

describe("retrieveEvidenceForQuestion", () => {
  it("returns in-org evidence with preference flags (text-only mode)", async () => {
    // websearch_to_tsquery ANDs bare terms — each retrieval targets one topic.
    const encryption = await retrieveEvidenceForQuestion({
      supabase: ownerAClient,
      organizationId: orgA,
      questionText: "Is data encrypted at rest?",
      contextTags: ["eu"],
      today: "2026-09-03",
    });

    // AI is force-disabled for this suite: retrieval ran without vectors and
    // made no provider call (hermetic budget contract — see beforeAll).
    expect(encryption.embeddingAvailable).toBe(false);
    expect(encryption.evidence.length).toBeGreaterThan(0);

    const freshChunk = encryption.evidence.find((item) => item.documentTitle === "Security Whitepaper");
    expect(freshChunk?.isStale).toBe(false);
    expect(freshChunk?.tagMatched).toBe(true);
    expect(freshChunk?.isApprovedAnswer).toBe(false);

    // Unapproved entries are not candidates at all (0003 filter).
    expect(encryption.evidence.some((item) => item.sourceId === entryDraftId)).toBe(false);

    const retention = await retrieveEvidenceForQuestion({
      supabase: ownerAClient,
      organizationId: orgA,
      questionText: "How long are logs retained?",
      contextTags: ["eu"],
      today: "2026-09-03",
    });
    expect(retention.evidence.length).toBeGreaterThan(0);

    const approvedEntry = retention.evidence.find((item) => item.sourceId === entryApprovedId);
    expect(approvedEntry?.sourceType).toBe("knowledge_entry");
    expect(approvedEntry?.isApprovedAnswer).toBe(true);
    expect(approvedEntry?.tagMatched).toBe(true);

    // The stale chunk matches only this phrasing — next to the approved entry
    // above it is (correctly) trimmed as weak tail: stale + untagged + weaker.
    const staleQuery = await retrieveEvidenceForQuestion({
      supabase: ownerAClient,
      organizationId: orgA,
      questionText: "Are logs kept twelve months according to policy?",
      today: "2026-09-03",
    });
    const staleChunk = staleQuery.evidence.find((item) => item.documentTitle === "Old Retention Memo");
    expect(staleChunk?.isStale).toBe(true);
    expect(staleChunk?.tagMatched).toBe(false);
  });

  it("never returns cross-tenant evidence", async () => {
    const outcome = await retrieveEvidenceForQuestion({
      supabase: ownerAClient,
      organizationId: orgA,
      questionText: "encryption at rest",
      today: "2026-09-03",
    });
    expect(outcome.evidence.length).toBeGreaterThan(0);
    // Every chunk belongs to an Org A document; entries carry documentId null.
    for (const item of outcome.evidence) {
      if (item.sourceType === "document_chunk") {
        expect(orgADocumentIds).toContain(item.documentId);
      } else {
        expect(item.sourceId).not.toBeNull();
      }
    }

    const orgBOutcome = await retrieveEvidenceForQuestion({
      supabase: ownerBClient,
      organizationId: orgB,
      questionText: "encryption at rest",
      today: "2026-09-03",
    });
    expect(orgBOutcome.evidence.length).toBeGreaterThan(0);
    // Org B sees only Org B documents and none of Org A's entries.
    for (const item of orgBOutcome.evidence) {
      if (item.sourceType === "document_chunk") {
        expect(orgBDocumentIds).toContain(item.documentId);
        expect(orgADocumentIds).not.toContain(item.documentId);
      }
      expect(item.sourceId).not.toBe(entryApprovedId);
      expect(item.sourceId).not.toBe(entryDraftId);
    }
  });

  it("an empty knowledge base yields an empty evidence set (abstention input)", async () => {
    const orgCOwner = await createTestUser("ret-owner-c", { fullName: "Retrieval Owner C" });
    const orgCClient = await signInAs(orgCOwner);
    const orgC = await createOrgAs(orgCClient, "Retrieval Org C", `ret-org-c-${Date.now().toString(36)}`);

    const outcome = await retrieveEvidenceForQuestion({
      supabase: orgCClient,
      organizationId: orgC,
      questionText: "What is your DR strategy?",
      today: "2026-09-03",
    });
    expect(outcome.evidence).toEqual([]);
    expect(outcome.embeddingAvailable).toBe(false);
  });
});
