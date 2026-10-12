/** Offline Week 5 evaluation gate: deterministic 50-question corpus. */

import { describe, expect, it } from "vitest";

import { computeEvidenceStrength, validateModelOutput } from "@/server/services/drafting";
import { selectEvidence } from "@/server/services/retrieval";
import { W5_CORPUS } from "../../fixtures/ai/w5-corpus";

const TODAY = "2026-09-03";

describe("W5 offline evaluation corpus", () => {
  it("contains the required 50 supported, ambiguous, conflicting, stale, and unsupported cases", () => {
    expect(W5_CORPUS).toHaveLength(50);
    expect(count("supported")).toBe(20);
    expect(count("ambiguous")).toBe(10);
    expect(count("conflicting")).toBe(8);
    expect(count("stale")).toBe(7);
    expect(count("unsupported")).toBe(5);
  });

  it("keeps at least 90% of directly supported questions grounded in retrieval", () => {
    const supported = W5_CORPUS.filter((item) => item.class === "supported");
    const recalled = supported.filter((item) => {
      const selected = selectEvidence(item.candidates, [], TODAY);
      return item.expectedSourceId !== null && selected.some((evidence) => evidence.sourceId === item.expectedSourceId);
    });

    expect(recalled.length / supported.length).toBeGreaterThanOrEqual(0.9);
  });

  it("never labels stale-only support as high strength", () => {
    for (const item of W5_CORPUS.filter((entry) => entry.class === "stale")) {
      const selected = selectEvidence(item.candidates, [], TODAY);
      const stale = selected.filter((evidence) => evidence.sourceId === item.expectedSourceId);
      expect(computeEvidenceStrength({ disposition: "answered", citedEvidence: stale })).toBe("low");
    }
  });

  it("abstains on every unsupported question instead of accepting fabricated text", () => {
    const unsupported = W5_CORPUS.filter((item) => item.class === "unsupported");
    const abstained = unsupported.filter((item) => {
      const decision = validateModelOutput({
        raw: JSON.stringify({
          answer: `Fabricated answer for ${item.id}.`,
          disposition: "answered",
          citation_ids: [],
          review_note: null,
        }),
        evidence: selectEvidence(item.candidates, [], TODAY),
      });
      return decision.disposition === "insufficient_evidence"
        && decision.answerText === ""
        && decision.citations.length === 0;
    });

    expect(abstained.length / unsupported.length).toBeGreaterThanOrEqual(0.9);
  });
});

function count(category: (typeof W5_CORPUS)[number]["class"]): number {
  return W5_CORPUS.filter((item) => item.class === category).length;
}
