import type { EvidenceCandidate } from "@/server/services/retrieval";

export type W5CorpusCase = {
  id: string;
  class: "supported" | "ambiguous" | "conflicting" | "stale" | "unsupported";
  question: string;
  expectedSourceId: string | null;
  candidates: EvidenceCandidate[];
};

/**
 * Small deterministic evaluation corpus for the offline W5 gate. The cases
 * deliberately include direct support, ambiguity, conflict, expired review
 * dates, and no-evidence questions; no provider or external service is used.
 */
export const W5_CORPUS: W5CorpusCase[] = [
  ...makeCases("supported", 20, (index) => ({
    expectedSourceId: sourceId("direct", index),
    candidates: [
      candidate(sourceId("direct", index), 0.9, `Direct support for control ${index}.`),
      candidate(sourceId("distractor", index), 0.35, `Unrelated distractor for control ${index}.`),
    ],
  })),
  ...makeCases("ambiguous", 10, (index) => ({
    expectedSourceId: sourceId("ambiguous", index),
    candidates: [
      candidate(sourceId("ambiguous", index), 0.74, `Partial support for ambiguous control ${index}.`),
      candidate(sourceId("ambiguous-alt", index), 0.72, `Alternate wording for ambiguous control ${index}.`),
    ],
  })),
  ...makeCases("conflicting", 8, (index) => ({
    expectedSourceId: sourceId("conflict-a", index),
    candidates: [
      candidate(sourceId("conflict-a", index), 0.82, `One policy version says yes for control ${index}.`),
      candidate(sourceId("conflict-b", index), 0.81, `Another policy version says no for control ${index}.`),
    ],
  })),
  ...makeCases("stale", 7, (index) => ({
    expectedSourceId: sourceId("stale", index),
    candidates: [
      candidate(sourceId("stale", index), 0.9, `Expired support for control ${index}.`, "2020-01-01"),
      candidate(sourceId("stale-distractor", index), 0.31, `Weak alternate for control ${index}.`),
    ],
  })),
  ...makeCases("unsupported", 5, () => ({ expectedSourceId: null, candidates: [] })),
];

function makeCases(
  category: W5CorpusCase["class"],
  count: number,
  build: (index: number) => Pick<W5CorpusCase, "expectedSourceId" | "candidates">,
): W5CorpusCase[] {
  return Array.from({ length: count }, (_, index) => {
    const values = build(index);
    return {
      id: `${category}-${index + 1}`,
      class: category,
      question: `Does control ${category}-${index + 1} meet the stated requirement?`,
      ...values,
    };
  });
}

function sourceId(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}

function candidate(sourceIdValue: string, combinedScore: number, content: string, reviewBy: string | null = null): EvidenceCandidate {
  return {
    sourceType: "document_chunk",
    sourceId: sourceIdValue,
    documentId: `document-${sourceIdValue}`,
    documentTitle: "Offline W5 corpus",
    section: "Security controls",
    content,
    combinedScore,
    tags: [],
    reviewBy,
    isApprovedAnswer: false,
  };
}
