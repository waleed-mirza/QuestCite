/** Client-safe serialized shapes for the resumable AI drafting workflow. */

export type AnswerRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type AnswerRunItemStatus = "pending" | "processing" | "completed" | "failed" | "skipped";
export type AiDisposition = "answered" | "needs_review" | "insufficient_evidence";
export type EvidenceStrength = "high" | "medium" | "low" | "insufficient";
export type AnswerAvailability = "ready" | "disabled" | "not_configured";

export type AnswerRunItemSummary = {
  id: string;
  questionId: string;
  status: AnswerRunItemStatus;
  attempts: number;
  errorCode: string | null;
  disposition: AiDisposition | null;
};

export type AnswerRunSnapshot = {
  id: string;
  questionnaireId: string;
  status: AnswerRunStatus;
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  skipped: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicroUsd: number;
  errorCode: string | null;
  items: AnswerRunItemSummary[];
};

export type EvidenceReference = {
  sourceType: "document_chunk" | "knowledge_entry";
  sourceId: string;
  title: string;
  section: string;
  excerpt: string;
  excerptSha256: string;
  retrievalScore: number;
  position: number;
  available: boolean;
  excerptMatches: boolean;
  stale: boolean;
};
