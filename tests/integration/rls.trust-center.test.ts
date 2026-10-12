/**
 * Week 7 Trust Center + gated sharing matrix (plan §W7 gate + AGENTS rule 7).
 * Proves PRIVATE DOCUMENTS AND INTERNAL METADATA CANNOT LEAK through public
 * pages or downloads:
 *
 * - anonymous callers reach ONLY the allowlisted overview RPC; unknown and
 *   unpublished slugs are indistinguishable (no existence leak).
 * - hidden content, archived documents, and documents without a ready
 *   version never render publicly and cannot be requested or granted.
 * - access requests: submit validation, clickwrap version+hash recording,
 *   atomic rate limits, verification flip, owner/admin-only review.
 * - grants are per (request, document): wrong document, wrong organization,
 *   revoked, or expired access is denied with one generic code.
 * - downloads write an append-only event; direct table access is denied for
 *   anonymous and cross-tenant callers on every W7 table.
 *
 * Runs against the linked hosted project through real clients (D016).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { expectError, expectErrorWithCode, expectNoRows, expectOk } from "./helpers/assert";
import { getAdminClient, getAnonClient } from "./helpers/clients";
import { cleanupStorage, provisionDocumentWithReadyVersion } from "./helpers/documents";
import {
  addMember,
  createOrgAs,
  createTestUser,
  disposeAll,
  signInAs,
  type TestUser,
} from "./helpers/fixtures";

type Client = Awaited<ReturnType<typeof signInAs>>;

const TERMS_TEXT = "Confidential — for evaluation only. Do not redistribute.";

let orgA = "";
let orgB = "";
let ownerA!: TestUser;
let adminA!: TestUser;
let reviewerA!: TestUser;
let viewerA!: TestUser;
let ownerB!: TestUser;
let ownerAClient!: Client;
let adminAClient!: Client;
let reviewerAClient!: Client;
let viewerAClient!: Client;
let ownerBClient!: Client;
let anon!: Client;
let admin!: ReturnType<typeof getAdminClient>;

// Fixtures provisioned in beforeAll.
let docReadyId = "";
let docArchivedId = "";
let docUnprocessedId = "";
let docHiddenId = "";
let docBId = "";
let slugA = "";
let slugB = "";

/** Publishes org A's trust center with full branding + terms + content. */
async function publishOrgA(): Promise<void> {
  const { error: tcError } = await admin.from("trust_centers").update({
    display_name: "W7 Org A Cloud",
    hero_title: "Security & Trust Center",
    hero_subtitle: "How we protect your data",
    overview: "Encryption everywhere, least privilege, annual third-party audits.",
    contact_email: "security@w7orga.example",
    terms_version: "v3",
    terms_text: TERMS_TEXT,
  }).eq("organization_id", orgA);
  expectOk({ data: null, error: tcError }, "seed org A trust center");

  expectOk(
    await admin.from("trust_center_faqs").insert({
      organization_id: orgA,
      question: "Is <script>alert(1)</script> allowed?",
      answer: "No — escaped output &lt;only&gt;.",
      visible: true,
    }),
    "seed visible faq",
  );
  expectOk(
    await admin.from("trust_center_faqs").insert({
      organization_id: orgA,
      question: "Internal-only question?",
      answer: "Hidden answer.",
      visible: false,
    }),
    "seed hidden faq",
  );
  expectOk(
    await admin.from("certifications").insert({
      organization_id: orgA,
      name: "SOC 2 Type II",
      status: "active",
      publicly_visible: true,
    }),
    "seed cert",
  );
  expectOk(
    await admin.from("subprocessors").insert({
      organization_id: orgA,
      company: "Acme Hosting",
      purpose: "Managed database",
      data_category: "Customer content",
      region: "eu-central-1",
      publicly_visible: true,
    }),
    "seed subprocessor",
  );

  for (const [documentId, description] of [
    [docReadyId, "Security overview (ready)"],
    [docArchivedId, "Archived policy"],
    [docUnprocessedId, "Still processing"],
    [docHiddenId, "Requestability off"],
  ] as const) {
    expectOk(
      await admin.from("trust_center_documents").insert({
        organization_id: orgA,
        document_id: documentId,
        description,
        publicly_requestable: true,
      }),
      `seed trust card ${description}`,
    );
  }
  // The hidden card flips requestability off after insert.
  expectOk(
    await admin.from("trust_center_documents").update({ publicly_requestable: false })
      .eq("organization_id", orgA).eq("document_id", docHiddenId),
    "hide the hidden card",
  );

  expectOk(
    await ownerAClient.rpc("set_trust_center_status", {
      p_organization_id: orgA,
      p_status: "published",
    }),
    "publish org A trust center",
  );
}

beforeAll(async () => {
  anon = getAnonClient();
  admin = getAdminClient();

  ownerA = await createTestUser("w7-owner-a", { fullName: "Owner A" });
  adminA = await createTestUser("w7-admin-a", { fullName: "Admin A" });
  reviewerA = await createTestUser("w7-reviewer-a", { fullName: "Reviewer A" });
  viewerA = await createTestUser("w7-viewer-a", { fullName: "Viewer A" });
  ownerB = await createTestUser("w7-owner-b", { fullName: "Owner B" });

  ownerAClient = await signInAs(ownerA);
  adminAClient = await signInAs(adminA);
  reviewerAClient = await signInAs(reviewerA);
  viewerAClient = await signInAs(viewerA);
  ownerBClient = await signInAs(ownerB);

  const suffix = Date.now().toString(36);
  orgA = await createOrgAs(ownerAClient, "W7 Org A", `w7-org-a-${suffix}`);
  orgB = await createOrgAs(ownerBClient, "W7 Org B", `w7-org-b-${suffix}`);
  await addMember(orgA, adminA.userId, "admin");
  await addMember(orgA, reviewerA.userId, "reviewer");
  await addMember(orgA, viewerA.userId, "viewer");

  const slugRowA = await admin.from("trust_centers").select("slug").eq("organization_id", orgA).single();
  const slugRowB = await admin.from("trust_centers").select("slug").eq("organization_id", orgB).single();
  slugA = slugRowA.data?.slug ?? "";
  slugB = slugRowB.data?.slug ?? "";
  expect(slugA).not.toBe("");
  expect(slugB).not.toBe("");

  const ready = await provisionDocumentWithReadyVersion({ organizationId: orgA, title: "Ready policy" });
  docReadyId = ready.documentId;
  const archived = await provisionDocumentWithReadyVersion({ organizationId: orgA, title: "Archived policy" });
  docArchivedId = archived.documentId;
  await admin.from("documents").update({ state: "archived" }).eq("id", docArchivedId);
  const unprocessed = await provisionDocumentWithReadyVersion({ organizationId: orgA, title: "Unprocessed policy" });
  docUnprocessedId = unprocessed.documentId;
  await admin.from("document_versions").update({ processing_state: "failed" }).eq("document_id", docUnprocessedId);
  const hidden = await provisionDocumentWithReadyVersion({ organizationId: orgA, title: "Hidden policy" });
  docHiddenId = hidden.documentId;
  const docB = await provisionDocumentWithReadyVersion({ organizationId: orgB, title: "Org B private doc" });
  docBId = docB.documentId;

  await publishOrgA();
});

afterAll(async () => {
  await cleanupStorage();
  await disposeAll();
});

// ---------------------------------------------------------------------------
// The public read: allowlisted, published-only, no existence leak
// ---------------------------------------------------------------------------

describe("public overview reads (anonymous)", () => {
  it("returns the allowlisted shape for a published center", async () => {
    const { data, error } = await anon.rpc("get_trust_center_overview", { p_slug: slugA });
    expectOk({ data, error }, "overview rpc");
    const payload = data as Record<string, unknown>;
    expect(payload.displayName).toBe("W7 Org A Cloud");
    expect(payload.termsVersion).toBe("v3");
    expect(payload.termsText).toBe(TERMS_TEXT);
    // Allowlist: no settings/organization_id/timestamps in the payload.
    expect(Object.keys(payload).sort()).toEqual([
      "certifications",
      "contactEmail",
      "displayName",
      "documents",
      "faqs",
      "heroSubtitle",
      "heroTitle",
      "logoUrl",
      "overview",
      "slug",
      "subprocessors",
      "termsText",
      "termsVersion",
    ]);
  });

  it("draft/archived/internal/expired documents never appear publicly", async () => {
    const { data } = await anon.rpc("get_trust_center_overview", { p_slug: slugA });
    const payload = data as { documents: Array<{ documentId: string }> };
    const ids = payload.documents.map((doc) => doc.documentId);
    expect(ids).toContain(docReadyId);
    expect(ids).not.toContain(docArchivedId); // archived
    expect(ids).not.toContain(docUnprocessedId); // no ready version
    expect(ids).not.toContain(docHiddenId); // requestability off
  });

  it("hidden FAQs never appear publicly", async () => {
    const { data } = await anon.rpc("get_trust_center_overview", { p_slug: slugA });
    const payload = data as { faqs: Array<{ question: string }> };
    expect(payload.faqs.some((faq) => faq.question.includes("Internal-only"))).toBe(false);
    expect(payload.faqs.some((faq) => faq.question.includes("<script>"))).toBe(true); // escaped at render; raw text stays
  });

  it("unknown and unpublished slugs are indistinguishable (both null)", async () => {
    const unknown = await anon.rpc("get_trust_center_overview", { p_slug: "no-such-center-xyz" });
    expectOk(unknown, "unknown slug rpc");
    expect(unknown.data).toBeNull();

    const draft = await anon.rpc("get_trust_center_overview", { p_slug: slugB });
    expectOk(draft, "draft slug rpc");
    expect(draft.data).toBeNull();
  });

  it("anonymous callers cannot select any trust table directly", async () => {
    expectNoRows(await anon.from("trust_centers").select("*"), "anon trust_centers");
    expectNoRows(await anon.from("trust_center_faqs").select("*"), "anon faqs");
    expectNoRows(await anon.from("trust_center_documents").select("*"), "anon cards");
    expectNoRows(await anon.from("access_requests").select("*"), "anon requests");
    expectNoRows(await anon.from("document_access_grants").select("*"), "anon grants");
    expectNoRows(await anon.from("nda_acceptances").select("*"), "anon nda rows");
    expectNoRows(await anon.from("download_events").select("*"), "anon download events");
  });
});

// ---------------------------------------------------------------------------
// Publishing rules
// ---------------------------------------------------------------------------

describe("publish lifecycle", () => {
  it("blocks publishing without branding + terms (PUBLISH_REQUIREMENTS)", async () => {
    expectErrorWithCode(
      await ownerBClient.rpc("set_trust_center_status", {
        p_organization_id: orgB,
        p_status: "published",
      }),
      "PUBLISH_REQUIREMENTS",
      "org B publish without branding",
    );
  });

  it("denies publish to reviewer/viewer and cross-org members", async () => {
    expectErrorWithCode(
      await reviewerAClient.rpc("set_trust_center_status", {
        p_organization_id: orgA,
        p_status: "draft",
      }),
      "FORBIDDEN",
      "reviewer cannot change status",
    );
    expectErrorWithCode(
      await ownerBClient.rpc("set_trust_center_status", {
        p_organization_id: orgA,
        p_status: "draft",
      }),
      "FORBIDDEN",
      "org B owner cannot touch org A",
    );
  });

  it("keeps publish-only fields and cross-tenant document links behind guarded writes", async () => {
    const directPublish = await ownerBClient
      .from("trust_centers")
      .update({ status: "published" })
      .eq("organization_id", orgB);
    if (directPublish.error === null) {
      await admin.from("trust_centers").update({ status: "draft" }).eq("organization_id", orgB);
    }
    expectError(directPublish, "direct trust-center publish bypass");

    const crossTenantCard = await ownerAClient.from("trust_center_documents").insert({
      organization_id: orgA,
      document_id: docBId,
      description: "Cross-tenant probe",
      publicly_requestable: true,
    });
    if (crossTenantCard.error === null) {
      await admin
        .from("trust_center_documents")
        .delete()
        .eq("organization_id", orgA)
        .eq("document_id", docBId);
    }
    expectError(crossTenantCard, "cross-tenant trust document link");

    const serviceCrossTenantCard = await admin.from("trust_center_documents").insert({
      organization_id: orgA,
      document_id: docBId,
      description: "Service-role cross-tenant probe",
      publicly_requestable: true,
    });
    if (serviceCrossTenantCard.error === null) {
      await admin
        .from("trust_center_documents")
        .delete()
        .eq("organization_id", orgA)
        .eq("document_id", docBId);
    }
    expectError(serviceCrossTenantCard, "service-role cross-tenant trust document link");

    const directSlug = await ownerBClient
      .from("trust_centers")
      .update({ slug: `direct-${Date.now().toString(36)}` })
      .eq("organization_id", orgB);
    if (directSlug.error === null) {
      await admin.from("trust_centers").update({ slug: slugB }).eq("organization_id", orgB);
    }
    expectError(directSlug, "direct trust-center slug update");

    expectErrorWithCode(
      await ownerBClient.rpc("set_trust_center_slug", {
        p_organization_id: orgB,
        p_slug: "admin",
      }),
      "TRUST_SLUG_RESERVED",
      "reserved trust-center slug",
    );

    const nextSlug = `w7-public-${Date.now().toString(36)}`;
    expectOk(
      await ownerBClient.rpc("set_trust_center_slug", {
        p_organization_id: orgB,
        p_slug: nextSlug,
      }),
      "owner changes trust-center slug",
    );
    slugB = nextSlug;
  });
});

// ---------------------------------------------------------------------------
// Request submission (anonymous)
// ---------------------------------------------------------------------------

type SubmitArgs = {
  p_slug: string;
  p_name?: string;
  p_company?: string;
  p_email?: string;
  p_document_ids?: string[];
  p_accept_terms?: boolean;
  p_ip_hash?: string;
  p_ua_summary?: string;
};

function submit(client: Client, args: SubmitArgs) {
  return client.rpc("submit_trust_access_request", {
    p_slug: args.p_slug,
    p_name: args.p_name ?? "Prospect Person",
    p_company: args.p_company ?? "Prospect Co",
    p_email: args.p_email ?? "prospect@example.com",
    p_document_ids: args.p_document_ids ?? [docReadyId],
    p_accept_terms: args.p_accept_terms ?? true,
    p_ip_hash: args.p_ip_hash ?? freshIp(),
    p_ua_summary: args.p_ua_summary ?? "Chrome on Windows",
  });
}

describe("access request submission", () => {
  it("rejects unpublished/unknown slugs identically", async () => {
    expectErrorWithCode(
      await submit(anon, { p_slug: "no-such-center-xyz" }),
      "TRUST_CENTER_NOT_FOUND",
      "unknown slug",
    );
    expectErrorWithCode(await submit(anon, { p_slug: slugB }), "TRUST_CENTER_NOT_FOUND", "draft slug");
  });

  it("rejects non-requestable documents with one code (no existence detail)", async () => {
    for (const documentId of [docArchivedId, docUnprocessedId, docHiddenId, docBId, crypto.randomUUID()]) {
      expectErrorWithCode(
        await submit(anon, { p_slug: slugA, p_document_ids: [documentId], p_ip_hash: crypto.randomUUID().padEnd(64, "0") }),
        "REQUEST_DOCUMENTS_INVALID",
        `doc ${documentId.slice(0, 8)}`,
      );
    }
  });

  it("requires clickwrap acceptance and valid identity input", async () => {
    expectErrorWithCode(
      await submit(anon, { p_slug: slugA, p_accept_terms: false, p_ip_hash: freshIp() }),
      "TERMS_NOT_ACCEPTED",
      "no acceptance",
    );
    expectErrorWithCode(
      await submit(anon, { p_slug: slugA, p_email: "not-an-email", p_ip_hash: freshIp() }),
      "REQUEST_INPUT_INVALID",
      "bad email",
    );
    expectErrorWithCode(
      await submit(anon, { p_slug: slugA, p_name: "   ", p_ip_hash: freshIp() }),
      "REQUEST_INPUT_INVALID",
      "blank name",
    );
  });

  it("creates a pending_review request + nda acceptance pinned to the CURRENT terms, notifies owner+admin only", async () => {
    const { data: requestId, error } = await submit(anon, { p_slug: slugA, p_email: "ok@example.com", p_ip_hash: freshIp() });
    expectOk({ data: requestId, error }, "valid submit");
    expect(requestId).not.toBeNull();
    const rowId = requestId as string;

    const { data: request } = await admin.from("access_requests").select("*").eq("id", rowId).single();
    expect(request?.state).toBe("pending_review");
    expect(request?.requested_document_ids).toEqual([docReadyId]);

    const { data: nda } = await admin.from("nda_acceptances").select("*").eq("access_request_id", rowId).single();
    expect(nda?.terms_version).toBe("v3");
    // Hash pins the exact stored terms text, not anything the browser sent.
    const { createHash } = await import("node:crypto");
    expect(nda?.terms_hash).toBe(createHash("sha256").update(TERMS_TEXT, "utf8").digest("hex"));

    const { data: notifications } = await admin
      .from("notifications")
      .select("user_id")
      .eq("organization_id", orgA)
      .eq("type", "trust_access.requested");
    const notified = new Set((notifications ?? []).map((row) => row.user_id));
    expect(notified.has(ownerA.userId)).toBe(true);
    expect(notified.has(adminA.userId)).toBe(true);
    expect(notified.has(reviewerA.userId)).toBe(false);
    expect(notified.has(viewerA.userId)).toBe(false);

    // Audit row for the anonymous submission (counts only).
    const { data: audit } = await admin
      .from("audit_events")
      .select("action")
      .eq("organization_id", orgA)
      .eq("action", "trust_access.request_submitted");
    expect((audit ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("rate limits per IP (5/hour) and per center (20/hour)", async () => {
    // Same IP: earlier tests used distinct IPs; this block burns the 5-slot
    // window for one dedicated IP then expects the 6th to fail. The IP is
    // unique per RUN (hex — the column check demands [0-9a-f]) because
    // rate-limit buckets persist on the hosted DB for the whole window.
    const limitedIp = "f".repeat(58) + Date.now().toString(16).slice(-6).padStart(6, "0");
    for (let i = 0; i < 5; i += 1) {
      expectOk(
        await submit(anon, {
          p_slug: slugA,
          p_email: `burst${i}@example.com`,
          p_ip_hash: limitedIp,
        }),
        `burst submit ${i + 1}`,
      );
    }
    expectErrorWithCode(
      await submit(anon, { p_slug: slugA, p_email: "burst6@example.com", p_ip_hash: limitedIp }),
      "RATE_LIMITED",
      "6th submit from same ip",
    );

    // Per-center: a fresh org with its own published center caps at 20.
    const rateOwner = await createTestUser("w7-rate-owner", { fullName: "Rate Owner" });
    const rateClient = await signInAs(rateOwner);
    const rateOrg = await createOrgAs(rateClient, "W7 Rate Org", `w7-rate-${Date.now().toString(36)}`);
    const { data: rateSlugRow } = await admin.from("trust_centers").select("slug").eq("organization_id", rateOrg).single();
    const rateSlug = rateSlugRow?.slug ?? "";
    const rateDoc = await provisionDocumentWithReadyVersion({ organizationId: rateOrg });
    await admin.from("trust_centers").update({
      display_name: "Rate Org",
      hero_title: "Trust",
      overview: "A sufficiently long overview for publishing this center.",
      contact_email: "security@rate.example",
      terms_version: "v1",
      terms_text: "Terms of evaluation access for rate limit tests.",
    }).eq("organization_id", rateOrg);
    await admin.from("trust_center_documents").insert({
      organization_id: rateOrg,
      document_id: rateDoc.documentId,
      description: "Rate test doc",
      publicly_requestable: true,
    });
    expectOk(
      await rateClient.rpc("set_trust_center_status", { p_organization_id: rateOrg, p_status: "published" }),
      "publish rate org",
    );

    for (let i = 0; i < 20; i += 1) {
      const result = await submit(anon, {
        p_slug: rateSlug,
        p_email: `orglimit${i}@example.com`,
        p_document_ids: [rateDoc.documentId],
        // Keep each request below the per-IP ceiling so this loop exercises
        // only the center bucket. Fresh hashes also make hosted reruns safe.
        p_ip_hash: freshIp(),
      });
      expectOk(result, `org submit ${i + 1}`);
    }
    expectErrorWithCode(
      await submit(anon, {
        p_slug: rateSlug,
        p_email: "orglimit20@example.com",
        p_document_ids: [rateDoc.documentId],
        p_ip_hash: freshIp(),
      }),
      "RATE_LIMITED",
      "21st submit for the center",
    );
  });
});

// ---------------------------------------------------------------------------
// Email verification (optional, per-center flag)
// ---------------------------------------------------------------------------

describe("email verification flow (D029)", () => {
  it("keeps requests in submitted until the confirm RPC flips them (idempotently)", async () => {
    // Turn verification on, submit, flip, turn back off.
    expectOk(
      await admin.from("trust_centers").update({ require_email_verification: true }).eq("organization_id", orgA),
      "enable verification",
    );
    const verificationEmail = `verify-${Date.now().toString(36)}@example.com`;
    const submission = await anon.rpc("submit_trust_access_request_result", {
      p_slug: slugA,
      p_name: "Prospect Person",
      p_company: "Prospect Co",
      p_email: verificationEmail,
      p_document_ids: [docReadyId],
      p_accept_terms: true,
      p_ip_hash: freshIp(),
      p_ua_summary: "Chrome on Windows",
    });
    expectOk(submission, "verified-mode submit");
    expect(submission.data).toMatchObject({ requiresEmailVerification: true });

    const { data: createdRequest } = await admin
      .from("access_requests")
      .select("id, state")
      .eq("prospect_email", verificationEmail)
      .single();
    expect(createdRequest?.id).toBeTruthy();
    const rowId = createdRequest?.id ?? "";
    const { data: before } = await admin.from("access_requests").select("state").eq("id", rowId).single();
    expect(before?.state).toBe("submitted");

    expectOk(await anon.rpc("confirm_trust_access_request", { p_request_id: rowId }), "confirm");
    const { data: after } = await admin.from("access_requests").select("state").eq("id", rowId).single();
    expect(after?.state).toBe("pending_review");

    // Re-running the confirm is a harmless no-op.
    expectOk(await anon.rpc("confirm_trust_access_request", { p_request_id: rowId }), "re-confirm");

    expectOk(
      await admin.from("trust_centers").update({ require_email_verification: false }).eq("organization_id", orgA),
      "disable verification",
    );
  });
});

// ---------------------------------------------------------------------------
// Review: approve/deny, grants, the one-time prospect token
// ---------------------------------------------------------------------------

/** Unique IP per fixture submit so the per-IP rate limit never interferes. */
function freshIp(): string {
  return crypto.randomUUID().replace(/-/g, "").padEnd(64, "0");
}

async function pendingRequestId(email: string): Promise<string> {
  const { data: requestId, error } = await submit(anon, { p_slug: slugA, p_email: email, p_ip_hash: freshIp() });
  expectOk({ data: requestId, error }, `submit for ${email}`);
  return requestId as string;
}

function review(client: Client, args: {
  p_request_id: string;
  p_decision: string;
  p_document_ids?: string[];
  p_grant_days?: number;
}) {
  return client.rpc("review_trust_access_request", {
    p_request_id: args.p_request_id,
    p_decision: args.p_decision,
    p_document_ids: args.p_document_ids ?? [],
    p_grant_days: args.p_grant_days ?? 7,
  });
}

describe("review + grants", () => {
  it("only owner/admin may review; others cannot even see the request", async () => {
    const requestId = await pendingRequestId("perms@example.com");
    expectErrorWithCode(
      await review(reviewerAClient, { p_request_id: requestId, p_decision: "denied" }),
      "FORBIDDEN",
      "reviewer review",
    );
    expectErrorWithCode(
      await review(viewerAClient, { p_request_id: requestId, p_decision: "denied" }),
      "FORBIDDEN",
      "viewer review",
    );
    expectErrorWithCode(
      await review(ownerBClient, { p_request_id: requestId, p_decision: "denied" }),
      "FORBIDDEN",
      "cross-org review",
    );
    expectError(
      await review(anon, { p_request_id: requestId, p_decision: "denied" }),
      "anonymous review (function not granted to anon)",
    );
  });

  it("approval creates per-document grants and returns the raw token exactly once", async () => {
    const requestId = await pendingRequestId("approve@example.com");
    const { data: token, error } = await review(adminAClient, {
      p_request_id: requestId,
      p_decision: "approved",
      p_document_ids: [docReadyId],
      p_grant_days: 7,
    });
    expectOk({ data: token, error }, "approve");
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const { data: request } = await admin.from("access_requests").select("*").eq("id", requestId).single();
    expect(request?.state).toBe("approved");
    expect(request?.prospect_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((request?.prospect_token_hash as string)).not.toBe(token as string); // hash, not raw

    const { data: grants } = await admin
      .from("document_access_grants")
      .select("*")
      .eq("access_request_id", requestId);
    expect(grants?.length).toBe(1);
    expect(grants?.[0]?.document_id).toBe(docReadyId);
    expect(grants?.[0]?.state).toBe("active");

    const { data: audit } = await admin
      .from("audit_events")
      .select("action, metadata")
      .eq("organization_id", orgA)
      .eq("action", "trust_access.approved");
    expect((audit ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("cannot grant documents outside the request or beyond 30 days", async () => {
    const requestId = await pendingRequestId("overreach@example.com");
    expectErrorWithCode(
      await review(ownerAClient, {
        p_request_id: requestId,
        p_decision: "approved",
        p_document_ids: [docReadyId, docBId],
      }),
      "REQUEST_DOCUMENTS_INVALID",
      "grant doc not requested (org B doc)",
    );
    expectErrorWithCode(
      await review(ownerAClient, {
        p_request_id: requestId,
        p_decision: "approved",
        p_document_ids: [docReadyId],
        p_grant_days: 31,
      }),
      "GRANT_DAYS_INVALID",
      "31 days",
    );
    // The failed attempts must not have resolved the request.
    const { data: still } = await admin.from("access_requests").select("state").eq("id", requestId).single();
    expect(still?.state).toBe("pending_review");
  });

  it("a reviewed request cannot be reviewed again", async () => {
    const requestId = await pendingRequestId("twice@example.com");
    expectOk(
      await review(ownerAClient, { p_request_id: requestId, p_decision: "denied" }),
      "deny",
    );
    expectErrorWithCode(
      await review(ownerAClient, { p_request_id: requestId, p_decision: "approved", p_document_ids: [docReadyId] }),
      "REQUEST_NOT_PENDING",
      "review after decision",
    );
    const { data: grants } = await admin
      .from("document_access_grants")
      .select("id")
      .eq("access_request_id", requestId);
    expect((grants ?? []).length).toBe(0); // denial issues no grants
  });
});

// ---------------------------------------------------------------------------
// Prospect gated view + downloads
// ---------------------------------------------------------------------------

describe("prospect gated access", () => {
  let approvedToken = "";
  let approvedRequestId = "";

  beforeAll(async () => {
    approvedRequestId = await pendingRequestId("download@example.com");
    const { data: token } = await review(ownerAClient, {
      p_request_id: approvedRequestId,
      p_decision: "approved",
      p_document_ids: [docReadyId],
      p_grant_days: 7,
    });
    approvedToken = token ?? "";
    expect(approvedToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("lists exactly the granted documents for the token holder", async () => {
    const { data, error } = await anon.rpc("trust_prospect_documents", {
      p_slug: slugA,
      p_raw_token: approvedToken,
    });
    expectOk({ data, error }, "prospect view");
    const payload = data as { documents: Array<{ documentId: string }>; termsCurrent: boolean };
    expect(payload.documents.map((doc) => doc.documentId)).toEqual([docReadyId]);
    expect(payload.termsCurrent).toBe(true); // accepted at submission, version unchanged
  });

  it("a token is bound to its slug — cross-org reuse fails generically", async () => {
    expectErrorWithCode(
      await anon.rpc("trust_prospect_documents", { p_slug: slugB, p_raw_token: approvedToken }),
      "ACCESS_LINK_INVALID",
      "org A token on org B slug",
    );
    expectErrorWithCode(
      await anon.rpc("trust_prospect_documents", { p_slug: slugA, p_raw_token: "0".repeat(64) }),
      "ACCESS_LINK_INVALID",
      "guessed token",
    );
  });

  it("downloads the granted document, writes an event, and denies every other document", async () => {
    const { data, error } = await anon.rpc("trust_download_document", {
      p_slug: slugA,
      p_raw_token: approvedToken,
      p_document_id: docReadyId,
      p_ip_hash: "3".repeat(64),
      p_ua_summary: "Firefox on Linux",
    });
    expectOk({ data, error }, "download authorized");
    const payload = data as { storagePath: string; filename: string };
    expect(payload.storagePath).toContain(docReadyId);
    expect(payload.filename).toBe("fixture.pdf");

    const { data: events } = await admin
      .from("download_events")
      .select("*")
      .eq("access_request_id", approvedRequestId);
    expect(events?.length).toBe(1);
    expect(events?.[0]?.ip_hash).toBe("3".repeat(64));
    expect(events?.[0]?.ua_summary).toBe("Firefox on Linux");

    // Not-granted document ids — including org B's real document — get the
    // same generic denial: the token reveals nothing about other documents.
    for (const documentId of [docBId, docHiddenId, crypto.randomUUID()]) {
      expectErrorWithCode(
        await anon.rpc("trust_download_document", {
          p_slug: slugA,
          p_raw_token: approvedToken,
          p_document_id: documentId,
          p_ip_hash: "3".repeat(64),
          p_ua_summary: "",
        }),
        "DOWNLOAD_NOT_ALLOWED",
        `download ungranted ${documentId.slice(0, 8)}`,
      );
    }
  });

  it("expired grants deny downloads; an expired REQUEST is the expired-link state", async () => {
    const requestId = await pendingRequestId("expiry@example.com");
    const { data: token } = await review(ownerAClient, {
      p_request_id: requestId,
      p_decision: "approved",
      p_document_ids: [docReadyId],
      p_grant_days: 1,
    });
    // Force GRANT expiry (service-role fixture manipulation): the link still
    // resolves (the request is alive) but shows nothing and denies downloads.
    await admin
      .from("document_access_grants")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("access_request_id", requestId);

    const view = await anon.rpc("trust_prospect_documents", { p_slug: slugA, p_raw_token: token ?? "" });
    expectOk(view, "prospect view with expired grants");
    expect((view.data as { documents: unknown[] }).documents).toEqual([]);
    expectErrorWithCode(
      await anon.rpc("trust_download_document", {
        p_slug: slugA,
        p_raw_token: token ?? "",
        p_document_id: docReadyId,
        p_ip_hash: "",
        p_ua_summary: "",
      }),
      "DOWNLOAD_NOT_ALLOWED",
      "download with expired grant",
    );

    // REQUEST expiry is the terminal link state: every prospect call answers
    // ACCESS_LINK_EXPIRED so the page can offer the re-request path.
    const requestId2 = await pendingRequestId("expiry-request@example.com");
    const { data: token2 } = await review(ownerAClient, {
      p_request_id: requestId2,
      p_decision: "approved",
      p_document_ids: [docReadyId],
      p_grant_days: 7,
    });
    await admin
      .from("access_requests")
      .update({ request_expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", requestId2);

    expectErrorWithCode(
      await anon.rpc("trust_prospect_documents", { p_slug: slugA, p_raw_token: token2 ?? "" }),
      "ACCESS_LINK_EXPIRED",
      "expired request view",
    );
    expectErrorWithCode(
      await anon.rpc("trust_download_document", {
        p_slug: slugA,
        p_raw_token: token2 ?? "",
        p_document_id: docReadyId,
        p_ip_hash: "",
        p_ua_summary: "",
      }),
      "ACCESS_LINK_EXPIRED",
      "expired request download",
    );
  });

  it("revoked grants deny immediately", async () => {
    const requestId = await pendingRequestId("revoke@example.com");
    const { data: token } = await review(ownerAClient, {
      p_request_id: requestId,
      p_decision: "approved",
      p_document_ids: [docReadyId],
      p_grant_days: 7,
    });
    const { data: grant } = await admin
      .from("document_access_grants")
      .select("id")
      .eq("access_request_id", requestId)
      .single();
    expectOk(
      await ownerAClient.rpc("revoke_access_grant", { p_grant_id: grant?.id ?? "" }),
      "revoke",
    );
    expectErrorWithCode(
      await anon.rpc("trust_download_document", {
        p_slug: slugA,
        p_raw_token: token ?? "",
        p_document_id: docReadyId,
        p_ip_hash: "",
        p_ua_summary: "",
      }),
      "DOWNLOAD_NOT_ALLOWED",
      "download after revoke",
    );
  });

  it("changed terms gate downloads until re-accepted (0022)", async () => {
    const requestId = await pendingRequestId("terms-change@example.com");
    const { data: token } = await review(adminAClient, {
      p_request_id: requestId,
      p_decision: "approved",
      p_document_ids: [docReadyId],
      p_grant_days: 7,
    });

    await admin
      .from("trust_centers")
      .update({ terms_version: "v4", terms_text: "Updated terms text for re-acceptance." })
      .eq("organization_id", orgA);

    expectErrorWithCode(
      await anon.rpc("trust_download_document", {
        p_slug: slugA,
        p_raw_token: token ?? "",
        p_document_id: docReadyId,
        p_ip_hash: "",
        p_ua_summary: "",
      }),
      "TERMS_NOT_ACCEPTED",
      "download under changed terms",
    );

    // The gated page shows termsCurrent=false until the prospect re-accepts…
    const view = await anon.rpc("trust_prospect_documents", { p_slug: slugA, p_raw_token: token ?? "" });
    expect((view.data as { termsCurrent: boolean }).termsCurrent).toBe(false);
    expectOk(
      await anon.rpc("trust_accept_terms", { p_slug: slugA, p_raw_token: token ?? "" }),
      "re-accept",
    );
    expectOk(
      await anon.rpc("trust_download_document", {
        p_slug: slugA,
        p_raw_token: token ?? "",
        p_document_id: docReadyId,
        p_ip_hash: "",
        p_ua_summary: "",
      }),
      "download after re-acceptance",
    );

    // Restore v3 so later fixtures stay deterministic.
    await admin
      .from("trust_centers")
      .update({ terms_version: "v3", terms_text: TERMS_TEXT })
      .eq("organization_id", orgA);
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant reads of internal tables
// ---------------------------------------------------------------------------

describe("cross-tenant RLS on W7 tables", () => {
  it("org B's owner sees none of org A's content or requests", async () => {
    expectNoRows(await ownerBClient.from("trust_center_faqs").select("*").eq("organization_id", orgA), "faqs cross-org");
    expectNoRows(await ownerBClient.from("certifications").select("*").eq("organization_id", orgA), "certs cross-org");
    expectNoRows(await ownerBClient.from("subprocessors").select("*").eq("organization_id", orgA), "subs cross-org");
    expectNoRows(await ownerBClient.from("trust_center_documents").select("*").eq("organization_id", orgA), "cards cross-org");
    expectNoRows(await ownerBClient.from("access_requests").select("*").eq("organization_id", orgA), "requests cross-org");
    expectNoRows(await ownerBClient.from("document_access_grants").select("*").eq("organization_id", orgA), "grants cross-org");
    expectNoRows(await ownerBClient.from("download_events").select("*").eq("organization_id", orgA), "downloads cross-org");
  });

  it("only owner/admin can read the queue and nobody can write access tables directly", async () => {
    await pendingRequestId("viewer-queue@example.com");
    expectNoRows(
      await viewerAClient.from("access_requests").select("id").eq("organization_id", orgA),
      "viewer queue read",
    );
    // Direct writes: the RPC-only tables reject inserts even for owners
    // (no insert grant/policy exists for any role).
    expectError(
      await ownerAClient.from("access_requests").insert({
        organization_id: orgA,
        prospect_name: "Direct",
        prospect_company: "Insert",
        prospect_email: "direct@example.com",
        requested_document_ids: [docReadyId],
        request_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
      "direct access_requests insert",
    );
    const { data: directRows } = await admin
      .from("access_requests")
      .select("id")
      .eq("prospect_email", "direct@example.com");
    expect((directRows ?? []).length).toBe(0);

    // FK-valid ids so the ONLY failing layer is the missing write grant.
    const { data: anyGrant } = await admin
      .from("document_access_grants")
      .select("id, access_request_id, document_id")
      .eq("organization_id", orgA)
      .limit(1)
      .maybeSingle();
    const { data: anyVersion } = await admin
      .from("document_versions")
      .select("id")
      .eq("document_id", anyGrant?.document_id ?? docReadyId)
      .limit(1)
      .maybeSingle();
    expectError(
      await ownerAClient.from("download_events").insert({
        organization_id: orgA,
        access_request_id: anyGrant?.access_request_id ?? crypto.randomUUID(),
        grant_id: anyGrant?.id ?? crypto.randomUUID(),
        document_id: anyGrant?.document_id ?? docReadyId,
        document_version_id: anyVersion?.id ?? crypto.randomUUID(),
      }),
      "download_events direct insert",
    );
  });
});
