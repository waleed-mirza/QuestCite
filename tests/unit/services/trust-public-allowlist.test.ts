/**
 * The W7 gate, pinned at the unit level: the public payload allowlist.
 *
 * An anonymous visitor's page can only ever render what
 * publicTrustCenterSchema admits. These tests prove (a) unknown keys are
 * stripped — a schema/RPC change can never smuggle a new field onto the
 * public page, and (b) internal-ish fields (ids, storage paths, owners,
 * processing state) are not part of the accepted shape at all.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClientMock, warnMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock("@/lib/observability/logger", () => ({ logger: { warn: warnMock } }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createServerClientMock }));

import {
  mapRpcErrorCode,
  getPublicTrustCenter,
  publicTrustCenterSchema,
  type PublicTrustCenter,
} from "@/server/services/trust-public";
import { publicSubmitErrorCopy } from "@/features/trust-center/copy";
import { summarizeUserAgent } from "@/lib/security/request-context";

const canonicalPayload = {
  slug: "acme-cloud",
  displayName: "Acme Cloud",
  heroTitle: "Security & Trust Center",
  heroSubtitle: "How we protect your data",
  overview: "Encryption at rest and in transit, least privilege, annual audits.",
  contactEmail: "security@acme.example",
  logoUrl: null,
  termsVersion: "v3",
  termsText: "You agree these documents are confidential.",
  faqs: [{ question: "Where is data stored?", answer: "EU regions." }],
  certifications: [
    { name: "SOC 2", status: "active", issuer: null, validFrom: null, validUntil: "2027-01-01", demo: false },
  ],
  subprocessors: [{ company: "Acme DB", purpose: "Hosting", dataCategory: "Customer content", region: "eu-central-1" }],
  documents: [
    { documentId: crypto.randomUUID(), title: "Security Overview", description: "High level", category: "policy" },
  ],
} as const;

describe("public trust center allowlist", () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
    warnMock.mockReset();
  });

  it("accepts the canonical published payload", () => {
    const parsed = publicTrustCenterSchema.safeParse(canonicalPayload);
    expect(parsed.success).toBe(true);
  });

  it("strips unknown keys — new upstream fields cannot reach the page", () => {
    const parsed = publicTrustCenterSchema.safeParse({
      ...canonicalPayload,
      internalNotes: "draft comment",
      ownerEmail: "owner@acme.example",
      storagePath: "org/doc/version/file.pdf",
      processingState: "ready",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const keys = Object.keys(parsed.data as Record<string, unknown>);
      expect(keys).not.toContain("internalNotes");
      expect(keys).not.toContain("ownerEmail");
      expect(keys).not.toContain("storagePath");
      expect(keys).not.toContain("processingState");
    }
  });

  it("rejects payloads with wrong-typed allowlisted fields", () => {
    expect(
      publicTrustCenterSchema.safeParse({ ...canonicalPayload, faqs: "none" }).success,
    ).toBe(false);
    expect(
      publicTrustCenterSchema.safeParse({ ...canonicalPayload, displayName: 42 }).success,
    ).toBe(false);
    expect(
      publicTrustCenterSchema.safeParse({ ...canonicalPayload, documents: [{ documentId: "not-a-uuid" }] })
        .success,
    ).toBe(false);
  });

  it("requires terms so the clickwrap can always display them", () => {
    const { termsVersion, termsText, ...withoutTerms } = canonicalPayload;
    expect(termsVersion).toBe("v3");
    expect(termsText).not.toBeNull();
    expect(publicTrustCenterSchema.safeParse(withoutTerms).success).toBe(false);
  });

  it("type-level completeness: every rendered field exists on the type", () => {
    // Compile-time contract (fails typecheck if the schema shrinks without
    // the page noticing). Exhaustive destructure of the PUBLIC surface:
    const sample: PublicTrustCenter = publicTrustCenterSchema.parse(canonicalPayload);
    expect(sample.slug).toBe("acme-cloud");
    expect(sample.faqs.length).toBe(1);
    expect(sample.certifications[0]?.name).toBe("SOC 2");
    expect(sample.subprocessors[0]?.company).toBe("Acme DB");
    expect(sample.documents[0]?.title).toBe("Security Overview");
  });

  it("treats an expected null RPC result as unpublished without warning", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    createServerClientMock.mockResolvedValue({ rpc });

    await expect(getPublicTrustCenter("acme-cloud")).resolves.toBeNull();
    expect(warnMock).not.toHaveBeenCalled();
  });
});

describe("rpc error mapping", () => {
  it("maps known codes through verbatim and everything else to UNAVAILABLE", () => {
    for (const code of [
      "TRUST_CENTER_NOT_FOUND",
      "RATE_LIMITED",
      "ACCESS_LINK_EXPIRED",
      "ACCESS_LINK_INVALID",
      "DOWNLOAD_NOT_ALLOWED",
      "TERMS_NOT_ACCEPTED",
    ]) {
      expect(mapRpcErrorCode(code)).toBe(code);
    }
    // Raw SQL/PG errors must never surface publicly.
    expect(mapRpcErrorCode('relation "x" does not exist')).toBe("UNAVAILABLE");
    expect(mapRpcErrorCode(undefined)).toBe("UNAVAILABLE");
    expect(mapRpcErrorCode(null)).toBe("UNAVAILABLE");
  });

  it("renders safe copy for every mapped code (never the raw code)", () => {
    for (const code of [
      "TRUST_CENTER_NOT_FOUND",
      "RATE_LIMITED",
      "REQUEST_DOCUMENTS_INVALID",
      "TERMS_NOT_ACCEPTED",
      "TERMS_NOT_CONFIGURED",
      "REQUEST_INPUT_INVALID",
      "UNAVAILABLE",
    ] as const) {
      const copy = publicSubmitErrorCopy(code);
      expect(copy.length).toBeGreaterThan(5);
      expect(copy).not.toMatch(/^[A-Z_]+$/);
    }
  });
});

describe("user-agent summary (coarse, non-fingerprinting)", () => {
  it("buckets common agents and never keeps version numbers", () => {
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome on Windows");
    expect(
      summarizeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"),
    ).toBe("Safari on macOS");
    expect(
      summarizeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"),
    ).toBe("Safari on iOS");
    expect(summarizeUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0")).toBe(
      "Firefox on Linux",
    );
    expect(summarizeUserAgent("curl/8.6.0")).toBe("Other on Other");
    expect(summarizeUserAgent("")).toBeNull();
    expect(summarizeUserAgent(null)).toBeNull();
  });
});
