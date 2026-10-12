/**
 * Evidence selection logic (plan §10 step 5–6): transparent, deterministic
 * preference ranking — approved Q&A first, tag matches boosted, stale
 * evidence penalized, weak tail dropped, evidence set capped at 8.
 */

import { describe, expect, it } from "vitest";

import { sha256Text } from "@/lib/files/checksum";
import {
  EVIDENCE_SET_MAX,
  isStale,
  selectEvidence,
  type EvidenceCandidate,
} from "@/server/services/retrieval";

const TODAY = "2026-09-03";

function candidate(overrides: Partial<EvidenceCandidate> = {}): EvidenceCandidate {
  return {
    sourceType: "document_chunk",
    sourceId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    documentTitle: "Fixture doc",
    section: "Security",
    content: "Fixture evidence content",
    combinedScore: 0.5,
    tags: [],
    reviewBy: null,
    isApprovedAnswer: false,
    ...overrides,
  };
}

describe("selectEvidence", () => {
  it("returns an empty set for an empty candidate pool", () => {
    expect(selectEvidence([], [], TODAY)).toEqual([]);
  });

  it("prefers an approved answer over a higher-scoring plain chunk", () => {
    const chunk = candidate({ combinedScore: 0.9 });
    const entry = candidate({
      sourceType: "knowledge_entry",
      documentId: null,
      documentTitle: null,
      section: "",
      combinedScore: 0.75,
      isApprovedAnswer: true,
    });

    const selected = selectEvidence([chunk, entry], [], TODAY);
    expect(selected[0]?.sourceType).toBe("knowledge_entry");
    expect(selected[0]?.isApprovedAnswer).toBe(true);
  });

  it("boosts tag matches and caps the bonus", () => {
    const plain = candidate({ combinedScore: 0.6, sourceId: "plain" });
    const tagged = candidate({ combinedScore: 0.6, sourceId: "tagged", tags: ["eu", "gdpr", "iso27001", "soc2"] });

    const selected = selectEvidence([plain, tagged], ["eu", "gdpr", "iso27001", "soc2", "hipaa"], TODAY);
    // Tag bonus caps at 0.2: 0.6 + 0.2 beats plain 0.6.
    expect(selected[0]?.sourceId).toBe("tagged");
    expect(selected[0]?.tagMatched).toBe(true);
    expect(selected[1]?.tagMatched).toBe(false);
  });

  it("penalizes evidence past its review date (stale)", () => {
    const fresh = candidate({ combinedScore: 0.7, sourceId: "fresh", reviewBy: "2099-01-01" });
    const stale = candidate({ combinedScore: 0.7, sourceId: "stale", reviewBy: "2020-01-01" });

    const selected = selectEvidence([fresh, stale], [], TODAY);
    expect(selected[0]?.sourceId).toBe("fresh");
    expect(selected[0]?.isStale).toBe(false);
    expect(selected[1]?.sourceId).toBe("stale");
    expect(selected[1]?.isStale).toBe(true);
  });

  it("drops the weak tail below 25% of the best adjusted score", () => {
    const strong = candidate({ combinedScore: 0.8, sourceId: "strong" });
    const medium = candidate({ combinedScore: 0.4, sourceId: "medium" });
    const weak = candidate({ combinedScore: 0.1, sourceId: "weak" });

    const selected = selectEvidence([weak, strong, medium], [], TODAY);
    // best 0.8 → cutoff 0.2: medium (0.4) stays, weak (0.1) drops.
    expect(selected.map((item) => item.sourceId)).toEqual(["strong", "medium"]);
  });

  it("caps the evidence set at 8 items", () => {
    const pool = Array.from({ length: 12 }, (_, index) =>
      candidate({ combinedScore: 0.9 - index * 0.01, sourceId: `c-${index}` }),
    );
    const selected = selectEvidence(pool, [], TODAY);
    expect(selected.length).toBe(EVIDENCE_SET_MAX);
  });

  it("hashes the excerpt for the citation record and carries the source ref through", () => {
    const content = "AES-256 encryption at rest is enabled for all storage volumes.";
    const [selected] = selectEvidence([candidate({ content })], [], TODAY);
    expect(selected?.excerpt).toBe(content);
    expect(selected?.excerptSha256).toBe(sha256Text(content));
    expect(selected?.retrievalScore).toBe(0.5);
    expect(selected?.documentTitle).toBe("Fixture doc");
  });
});

describe("isStale", () => {
  it("is true only when the review date is strictly in the past", () => {
    expect(isStale("2026-09-02", TODAY)).toBe(true);
    expect(isStale(TODAY, TODAY)).toBe(false);
    expect(isStale("2027-01-01", TODAY)).toBe(false);
    expect(isStale(null, TODAY)).toBe(false);
  });
});
