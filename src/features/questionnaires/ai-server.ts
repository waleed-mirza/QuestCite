import "server-only";

import type { Database } from "@/types/database.types";
import { sha256Text } from "@/lib/files/checksum";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AnswerRunSnapshot,
  AnswerRunItemSummary,
  AnswerRunItemStatus,
  EvidenceReference,
} from "@/features/questionnaires/ai-types";

type CitationRow = Pick<
  Database["public"]["Tables"]["answer_citations"]["Row"],
  "answer_id" | "source_type" | "source_id" | "excerpt_sha256" | "retrieval_score" | "position"
>;
type DocumentChunkReference = Pick<
  Database["public"]["Tables"]["document_chunks"]["Row"],
  "id" | "document_id" | "version_id" | "content" | "section"
>;
type DocumentVersionReference = Pick<
  Database["public"]["Tables"]["document_versions"]["Row"],
  "id" | "document_id" | "processing_state" | "version_number"
>;
type KnowledgeEntryReference = Pick<
  Database["public"]["Tables"]["knowledge_entries"]["Row"],
  "id" | "question" | "answer" | "review_by"
>;

export async function getAnswerRunSnapshot(
  organizationId: string,
  runId: string,
): Promise<AnswerRunSnapshot | null> {
  const supabase = await createSupabaseServerClient();
  const { data: run, error: runError } = await supabase
    .from("answer_runs")
    .select("id, questionnaire_id, status, input_tokens, output_tokens, estimated_cost_micro_usd, error_code")
    .eq("id", runId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (runError !== null || run === null) {
    if (runError !== null) {
      logger.warn("answer run lookup failed", { code: "QUERY_FAILED" });
    }
    return null;
  }

  const { data: items, error: itemsError } = await supabase
    .from("answer_run_items")
    .select("id, question_id, status, attempts, error_code, disposition")
    .eq("run_id", runId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (itemsError !== null || items === null) {
    logger.warn("answer run items lookup failed", { code: itemsError === null ? "NO_DATA" : "QUERY_FAILED" });
    return null;
  }

  const summaries: AnswerRunItemSummary[] = items.map((item) => ({
    id: item.id,
    questionId: item.question_id,
    status: item.status,
    attempts: item.attempts,
    errorCode: item.error_code,
    disposition: item.disposition,
  }));
  const count = (status: AnswerRunItemStatus): number => summaries.filter((item) => item.status === status).length;
  return {
    id: run.id,
    questionnaireId: run.questionnaire_id,
    status: run.status,
    total: summaries.length,
    pending: count("pending"),
    processing: count("processing"),
    completed: count("completed"),
    failed: count("failed"),
    skipped: count("skipped"),
    inputTokens: run.input_tokens,
    outputTokens: run.output_tokens,
    estimatedCostMicroUsd: run.estimated_cost_micro_usd,
    errorCode: run.error_code,
    items: summaries,
  };
}

export async function getLatestAnswerRunSnapshot(
  organizationId: string,
  questionnaireId: string,
): Promise<AnswerRunSnapshot | null> {
  const supabase = await createSupabaseServerClient();
  const { data: run, error } = await supabase
    .from("answer_runs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("questionnaire_id", questionnaireId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error !== null || run === null) {
    if (error !== null) {
      logger.warn("latest answer run lookup failed", { code: "QUERY_FAILED" });
    }
    return null;
  }
  return getAnswerRunSnapshot(organizationId, run.id);
}

/**
 * Rehydrates citations for the evidence drawer without trusting the
 * polymorphic source id. Every source query carries the organization filter;
 * document chunks and knowledge entries are also checked for their current
 * visibility before content is returned.
 */
export async function listAnswerEvidence(
  organizationId: string,
  answerIds: string[],
): Promise<Record<string, EvidenceReference[]>> {
  if (answerIds.length === 0) {
    return {};
  }
  const supabase = await createSupabaseServerClient();
  const { data: citations, error: citationError } = await supabase
    .from("answer_citations")
    .select("answer_id, source_type, source_id, excerpt_sha256, retrieval_score, position")
    .eq("organization_id", organizationId)
    .in("answer_id", answerIds)
    .order("position", { ascending: true });
  if (citationError !== null || citations === null) {
    logger.warn("answer citation lookup failed", { code: "QUERY_FAILED" });
    return {};
  }

  const typedCitations: CitationRow[] = citations;
  const chunkIds = [...new Set(typedCitations.filter((row) => row.source_type === "document_chunk").map((row) => row.source_id))];
  const entryIds = [...new Set(typedCitations.filter((row) => row.source_type === "knowledge_entry").map((row) => row.source_id))];

  const [chunkResult, entryResult] = await Promise.all([
    loadDocumentChunks(supabase, organizationId, chunkIds),
    loadKnowledgeEntries(supabase, organizationId, entryIds),
  ]);

  if (chunkResult.error !== null) {
    logger.warn("citation document lookup failed", { code: "QUERY_FAILED" });
  }
  if (entryResult.error !== null) {
    logger.warn("citation entry lookup failed", { code: "QUERY_FAILED" });
  }

  const documentIds = [...new Set((chunkResult.data ?? []).map((row) => row.document_id))];
  const versionIds = [...new Set((chunkResult.data ?? []).map((row) => row.version_id))];
  const [documentResult, versionResult] = await Promise.all([
    loadDocuments(supabase, organizationId, documentIds),
    loadDocumentVersions(supabase, organizationId, versionIds),
  ]);
  if (documentResult.error !== null) {
    logger.warn("citation document metadata lookup failed", { code: "QUERY_FAILED" });
  }
  if (versionResult.error !== null) {
    logger.warn("citation document version lookup failed", { code: "QUERY_FAILED" });
  }
  const documentById = new Map(documentResult.data.map((document) => [document.id, document]));
  const versionById = new Map(versionResult.data.map((version) => [version.id, version]));
  const currentReadyVersionByDocument = new Map<string, DocumentVersionReference>();
  for (const version of versionResult.data) {
    if (version.processing_state !== "ready") continue;
    const current = currentReadyVersionByDocument.get(version.document_id);
    if (current === undefined || version.version_number > current.version_number) {
      currentReadyVersionByDocument.set(version.document_id, version);
    }
  }
  const chunksById = new Map((chunkResult.data ?? []).map((chunk) => [chunk.id, chunk]));
  const entriesById = new Map((entryResult.data ?? []).map((entry) => [entry.id, entry]));
  const today = new Date().toISOString().slice(0, 10);
  const byAnswer: Record<string, EvidenceReference[]> = {};

  for (const citation of typedCitations) {
    const sourceType = citation.source_type === "knowledge_entry" ? "knowledge_entry" : "document_chunk";
    let reference: EvidenceReference;
    const chunk = sourceType === "document_chunk" ? chunksById.get(citation.source_id) : undefined;
    const entry = sourceType === "knowledge_entry" ? entriesById.get(citation.source_id) : undefined;
    if (chunk !== undefined) {
      const document = documentById.get(chunk.document_id);
      const version = versionById.get(chunk.version_id);
      const currentVersion = currentReadyVersionByDocument.get(chunk.document_id);
      const excerpt = chunk.content;
      reference = {
        sourceType,
        sourceId: citation.source_id,
        title: document?.title ?? "Security document",
        section: chunk.section,
        excerpt,
        excerptSha256: citation.excerpt_sha256,
        retrievalScore: citation.retrieval_score,
        position: citation.position,
        available: true,
        excerptMatches: sha256Text(excerpt) === citation.excerpt_sha256,
        stale: document?.state !== "active"
          || version?.processing_state !== "ready"
          || currentVersion?.id !== version.id
          || (document.review_by !== null && document.review_by < today),
      };
    } else if (entry !== undefined) {
      const excerpt = entry.answer;
      reference = {
        sourceType,
        sourceId: citation.source_id,
        title: "Approved Q&A entry",
        section: entry.question,
        excerpt,
        excerptSha256: citation.excerpt_sha256,
        retrievalScore: citation.retrieval_score,
        position: citation.position,
        available: true,
        excerptMatches: sha256Text(excerpt) === citation.excerpt_sha256,
        stale: entry.review_by !== null && entry.review_by < today,
      };
    } else {
      reference = {
        sourceType,
        sourceId: citation.source_id,
        title: "Source unavailable",
        section: "",
        excerpt: "",
        excerptSha256: citation.excerpt_sha256,
        retrievalScore: citation.retrieval_score,
        position: citation.position,
        available: false,
        excerptMatches: false,
        stale: false,
      };
    }
    const list = byAnswer[citation.answer_id] ?? [];
    list.push(reference);
    byAnswer[citation.answer_id] = list;
  }
  return byAnswer;
}

async function loadDocumentChunks(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  ids: string[],
): Promise<{ data: DocumentChunkReference[]; error: Error | null }> {
  if (ids.length === 0) {
    return { data: [], error: null };
  }
  const { data, error } = await supabase
    .from("document_chunks")
    .select("id, document_id, version_id, content, section")
    .eq("organization_id", organizationId)
    .in("id", ids);
  return { data: data ?? [], error };
}

async function loadDocuments(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  ids: string[],
): Promise<{ data: Array<Pick<Database["public"]["Tables"]["documents"]["Row"], "id" | "title" | "review_by" | "state">>; error: Error | null }> {
  if (ids.length === 0) {
    return { data: [], error: null };
  }
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, review_by, state")
    .eq("organization_id", organizationId)
    .in("id", ids);
  return { data: data ?? [], error };
}

async function loadDocumentVersions(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  ids: string[],
): Promise<{ data: DocumentVersionReference[]; error: Error | null }> {
  if (ids.length === 0) {
    return { data: [], error: null };
  }
  const { data, error } = await supabase
    .from("document_versions")
    .select("id, document_id, processing_state, version_number")
    .eq("organization_id", organizationId)
    .in("id", ids);
  return { data: data ?? [], error };
}

async function loadKnowledgeEntries(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  ids: string[],
): Promise<{ data: KnowledgeEntryReference[]; error: Error | null }> {
  if (ids.length === 0) {
    return { data: [], error: null };
  }
  const { data, error } = await supabase
    .from("knowledge_entries")
    .select("id, question, answer, review_by")
    .eq("organization_id", organizationId)
    .eq("review_state", "approved")
    .in("id", ids);
  return { data: data ?? [], error };
}
