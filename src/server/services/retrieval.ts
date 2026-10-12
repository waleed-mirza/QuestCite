import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { EmbeddingError, getEmbeddingProvider } from "@/lib/ai/embeddings";
import { sha256Text } from "@/lib/files/checksum";
import { logger } from "@/lib/observability/logger";
import type { Database } from "@/types/database.types";

/**
 * Evidence retrieval service (plan §10 steps 1–7).
 *
 * One query embedding (when the provider is configured — otherwise the RPC
 * degrades gracefully to full-text-only), the org-scoped hybrid search
 * `match_org_evidence` (0003/0009/0016: current ready versions of active
 * documents + approved knowledge entries ONLY, so nothing outside the org's
 * permitted evidence can even be a candidate), then a transparent,
 * deterministic preference pass (plan §10 step 5):
 *
 *   adjusted = combinedScore            (0.75·vector + 0.25·text, per 0003)
 *            + APPROVED_ANSWER_BONUS    (approved Q&A is the strongest class)
 *            + TAG_MATCH_BONUS          (capped — product/geo tag overlap)
 *            - STALE_PENALTY            (evidence past its review date)
 *
 * The adjusted score never reaches the user or the model — it only orders the
 * candidate pool into the 4–8-item evidence set. Weights are explicit
 * constants on purpose: transparent labels, never a fake percentage (plan
 * §10 evidence-strength rule).
 */

export const RETRIEVAL_CANDIDATE_POOL = 24;
export const EVIDENCE_SET_MAX = 8;
/** Drop the weak tail: anything scoring below this ratio of the best adjusted score. */
const WEAK_TAIL_RATIO = 0.25;
const APPROVED_ANSWER_BONUS = 0.25;
const TAG_MATCH_BONUS = 0.1;
const TAG_MATCH_BONUS_CAP = 0.2;
const STALE_PENALTY = 0.2;

export type EvidenceSourceType = "document_chunk" | "knowledge_entry";

/** One row of the RPC's widened output (0016). */
export type EvidenceCandidate = {
  sourceType: EvidenceSourceType;
  sourceId: string;
  documentId: string | null;
  documentTitle: string | null;
  section: string;
  content: string;
  combinedScore: number;
  tags: string[];
  reviewBy: string | null;
  isApprovedAnswer: boolean;
};

/** One selected member of the evidence set — what the model sees, and what the drawer shows. */
export type SelectedEvidence = {
  sourceType: EvidenceSourceType;
  sourceId: string;
  documentId: string | null;
  documentTitle: string | null;
  section: string;
  /** The excerpt passed to the model; the citation stores its SHA-256, never a copy. */
  excerpt: string;
  excerptSha256: string;
  /** Combined hybrid score from the RPC (0..1 domain, informational). */
  retrievalScore: number;
  isApprovedAnswer: boolean;
  /** Evidence past its review date — mandatory-human-review input (plan §10). */
  isStale: boolean;
  /** Evidence sharing at least one product/geo tag with the question context. */
  tagMatched: boolean;
};

export type RetrievalOutcome = {
  evidence: SelectedEvidence[];
  /** False when no embedding provider is configured — retrieval ran text-only. */
  embeddingAvailable: boolean;
};

export class RetrievalError extends Error {
  readonly code: "RETRIEVAL_NOT_FOUND" | "RETRIEVAL_FORBIDDEN" | "RETRIEVAL_QUERY_INVALID" | "RETRIEVAL_FAILED";

  constructor(code: RetrievalError["code"]) {
    super(code);
    this.name = "RetrievalError";
    this.code = code;
  }
}

/**
 * Generated RPC arg types cannot express a NULL Postgres parameter (the same
 * documented limitation the W4/W5 suites handle with reviewed wrappers); the
 * embedding-less path is a SUPPORTED mode of the RPC (0003 treats NULL as
 * text-only search), so this override holds one narrow, reviewed assertion.
 */
type EvidenceArgs = Omit<
  Database["public"]["Functions"]["match_org_evidence"]["Args"],
  "p_query_embedding"
> & { p_query_embedding: string | null };

/** Orders and trims the candidate pool into the evidence set. Pure — unit-tested. */
export function selectEvidence(
  candidates: EvidenceCandidate[],
  contextTags: readonly string[],
  today: string,
): SelectedEvidence[] {
  if (candidates.length === 0) {
    return [];
  }

  const adjusted = candidates.map((candidate) => {
    const matchedTags = candidate.tags.filter((tag) => contextTags.includes(tag));
    const stale = isStale(candidate.reviewBy, today);
    let score = candidate.combinedScore;
    if (candidate.isApprovedAnswer) {
      score += APPROVED_ANSWER_BONUS;
    }
    score += Math.min(matchedTags.length * TAG_MATCH_BONUS, TAG_MATCH_BONUS_CAP);
    if (stale) {
      score -= STALE_PENALTY;
    }
    return { candidate, matched: matchedTags.length > 0, stale, score };
  });

  adjusted.sort((a, b) => b.score - a.score);

  const best = Math.max(adjusted[0]?.score ?? 0, 0.0001);
  const selected: SelectedEvidence[] = [];
  for (const entry of adjusted) {
    if (selected.length >= EVIDENCE_SET_MAX) {
      break;
    }
    if (selected.length > 0 && entry.score < best * WEAK_TAIL_RATIO) {
      break;
    }
    selected.push(toSelected(entry.candidate, entry.matched, entry.stale));
  }
  return selected;
}

export function isStale(reviewBy: string | null, today: string): boolean {
  return reviewBy !== null && reviewBy < today;
}

function toSelected(candidate: EvidenceCandidate, tagMatched: boolean, stale: boolean): SelectedEvidence {
  return {
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    documentId: candidate.documentId,
    documentTitle: candidate.documentTitle,
    section: candidate.section,
    excerpt: candidate.content,
    excerptSha256: sha256Text(candidate.content),
    retrievalScore: candidate.combinedScore,
    isApprovedAnswer: candidate.isApprovedAnswer,
    isStale: stale,
    tagMatched,
  };
}

/**
 * Runs retrieval for one question. Uses the USER's client — the RPC
 * re-checks membership server-side (defense in depth, mirroring ingestion).
 */
export async function retrieveEvidenceForQuestion(input: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  questionText: string;
  contextTags?: readonly string[];
  today?: string;
}): Promise<RetrievalOutcome> {
  const provider = getEmbeddingProvider();
  let queryEmbedding: string | null = null;
  let embeddingAvailable = false;
  if (provider !== null) {
    try {
      const [vector] = await provider.embed([input.questionText]);
      if (vector !== undefined) {
        queryEmbedding = `[${vector.join(",")}]`;
        embeddingAvailable = true;
      }
    } catch (error) {
      // Graceful degradation: the RPC treats a NULL embedding as text-only
      // search. Logged by safe code only (provider bodies can echo input).
      const code = error instanceof EmbeddingError ? error.code : "EMBEDDING_FAILED";
      logger.warn("query embedding unavailable; retrieval degrades to text-only", { code });
    }
  }

  const args: EvidenceArgs = {
    p_organization_id: input.organizationId,
    p_query_embedding: queryEmbedding,
    p_query_text: input.questionText,
    p_match_count: RETRIEVAL_CANDIDATE_POOL,
  };
  const { data, error } = await input.supabase.rpc(
    "match_org_evidence",
    args as Database["public"]["Functions"]["match_org_evidence"]["Args"],
  );

  if (error !== null) {
    logger.warn("evidence retrieval failed", { code: "QUERY_FAILED" });
    throw new RetrievalError(toErrorCode(error.message));
  }

  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const candidates = (data ?? []).map(toCandidate);
  return {
    evidence: selectEvidence(candidates, input.contextTags ?? [], today),
    embeddingAvailable,
  };
}

function toCandidate(row: Record<string, unknown>): EvidenceCandidate {
  const sourceType = row.source_type === "knowledge_entry" ? "knowledge_entry" : "document_chunk";
  return {
    sourceType,
    sourceId: String(row.source_id ?? ""),
    documentId: row.document_id === null || row.document_id === undefined ? null : String(row.document_id),
    documentTitle: row.document_title === null || row.document_title === undefined ? null : String(row.document_title),
    section: typeof row.section === "string" ? row.section : "",
    content: typeof row.content === "string" ? row.content : "",
    combinedScore: typeof row.combined_score === "number" ? row.combined_score : 0,
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    reviewBy: row.review_by === null || row.review_by === undefined ? null : String(row.review_by),
    isApprovedAnswer: row.is_approved_answer === true,
  };
}

function toErrorCode(message: string): RetrievalError["code"] {
  if (message.includes("AUTH_REQUIRED")) return "RETRIEVAL_NOT_FOUND";
  if (message.includes("FORBIDDEN")) return "RETRIEVAL_FORBIDDEN";
  if (message.includes("EVIDENCE_QUERY_INVALID")) return "RETRIEVAL_QUERY_INVALID";
  return "RETRIEVAL_FAILED";
}
