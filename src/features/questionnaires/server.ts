import "server-only";

import type { Database } from "@/types/database.types";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inspectWorkbook } from "@/lib/files/questionnaire/inspect";
import type { WorkbookInspection } from "@/lib/files/questionnaire/types";
import { listMembers } from "@/features/members/server";
import type { AiDisposition, EvidenceStrength, EvidenceReference } from "@/features/questionnaires/ai-types";
import {
  countQuestionnaireProgress,
  type QuestionnaireProgress,
} from "@/features/questionnaires/progress";
import {
  summarizeExportReadiness,
  type ExportHistoryRow,
  type ExportReadiness,
} from "@/features/questionnaires/export-rules";
import {
  summarizeByAssignee,
  summarizeByCategory,
  summarizeByStatus,
  type AssigneeSlice,
  type CategorySlice,
  type DashboardRow,
  type StatusSlice,
} from "@/features/questionnaires/dashboard";

export type { QuestionnaireProgress };

/**
 * Read models for the questionnaires surface. All queries run through the
 * user's own client — RLS scopes every row to the caller's organizations, so
 * the org guard in the pages is UX; the database is the boundary. The mapping
 * preview reads the ORIGINAL file back from storage and re-inspects it, so
 * what the user confirms against is exactly what was stored at upload.
 */

type QuestionnaireRow = Database["public"]["Tables"]["questionnaires"]["Row"];
type QuestionnaireFileRow = Database["public"]["Tables"]["questionnaire_files"]["Row"];
type AnswerStatus = Database["public"]["Enums"]["answer_status"];

export type QuestionnaireListItem = QuestionnaireRow & {
  questionCount: number;
  format: string | null;
};

export async function listQuestionnaires(organizationId: string): Promise<QuestionnaireListItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from("questionnaires")
    .select("*, questions(count), questionnaire_files(format)")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error !== null || rows === null) {
    logger.warn("questionnaire list query failed", { code: error === null ? "NO_DATA" : "QUERY_FAILED" });
    return [];
  }

  return rows.map((row) => {
    // supabase-js types nested count selects loosely — one narrowing read.
    const record = row as QuestionnaireRow & {
      questions: Array<{ count: number }> | null;
      questionnaire_files: Array<{ format: string }> | null;
    };
    return {
      ...row,
      questionCount: record.questions?.[0]?.count ?? 0,
      format: record.questionnaire_files?.[0]?.format ?? null,
    };
  });
}

export type QuestionnaireDetail = {
  questionnaire: QuestionnaireRow;
  file: Pick<
    QuestionnaireFileRow,
    "id" | "storage_path" | "format" | "mime_type" | "byte_size" | "checksum_sha256" | "parser_version" | "metadata"
  > | null;
  assignedReviewerName: string | null;
};

export async function getQuestionnaireDetail(
  organizationId: string,
  questionnaireId: string,
): Promise<QuestionnaireDetail | null> {
  const supabase = await createSupabaseServerClient();

  const { data: questionnaire, error } = await supabase
    .from("questionnaires")
    .select("*")
    .eq("id", questionnaireId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error !== null || questionnaire === null) {
    return null;
  }

  const { data: file } = await supabase
    .from("questionnaire_files")
    .select("id, storage_path, format, mime_type, byte_size, checksum_sha256, parser_version, metadata")
    .eq("questionnaire_id", questionnaireId)
    .maybeSingle();

  // reviewer_id points at auth.users, not profiles (no FK to nest on) —
  // resolved separately; an invisible/departed member renders as null.
  let assignedReviewerName: string | null = null;
  if (questionnaire.assigned_reviewer !== null) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", questionnaire.assigned_reviewer)
      .maybeSingle();
    const fullName = profile?.full_name.trim() ?? "";
    assignedReviewerName = fullName !== "" ? fullName : null;
  }

  return { questionnaire, file: file ?? null, assignedReviewerName };
}

export type MappingPreview = {
  detail: QuestionnaireDetail;
  bytes: Uint8Array;
  format: "xlsx" | "csv";
  parserVersion: string;
  inspection: WorkbookInspection;
};

/**
 * Downloads the stored original through the user's client (storage RLS
 * re-verifies the org from the path) and re-inspects it for the mapping
 * preview. `null` means the original could not be read — the page renders a
 * failure state (this is also how a lost storage object surfaces after an
 * interrupted upload).
 */
export async function getMappingPreview(
  organizationId: string,
  questionnaireId: string,
): Promise<MappingPreview | null | "STORAGE_UNAVAILABLE"> {
  const detail = await getQuestionnaireDetail(organizationId, questionnaireId);
  if (detail === null || detail.file === null) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from("questionnaires")
    .download(detail.file.storage_path);
  if (error !== null || data === null) {
    logger.warn("questionnaire original download failed", { code: error === null ? "NO_DATA" : "QUERY_FAILED" });
    return "STORAGE_UNAVAILABLE";
  }
  const bytes = new Uint8Array(await data.arrayBuffer());

  // The stored bytes are the parsed bytes (checksum-pinned at upload) — but
  // never trust: the same inspect gate (zip safety scan + parser) runs again,
  // and a stored object that no longer parses fails closed here.
  const inspection = await inspectWorkbook(bytes, detail.file.format === "csv" ? "csv" : "xlsx");
  if (!inspection.ok) {
    logger.warn("stored questionnaire failed re-inspection", { code: inspection.code });
    return "STORAGE_UNAVAILABLE";
  }

  return {
    detail,
    bytes,
    format: detail.file.format === "csv" ? "csv" : "xlsx",
    parserVersion: inspection.value.parserVersion,
    inspection: inspection.value,
  };
}

// ---------------------------------------------------------------------------
// Question data table
// ---------------------------------------------------------------------------

export const QUESTIONS_PAGE_SIZE = 25;

export type QuestionRow = {
  id: string;
  position: number;
  sheetName: string;
  rowNumber: number;
  questionCell: string;
  answerCell: string | null;
  notesCell: string | null;
  questionOriginal: string;
  category: string;
  status: AnswerStatus;
  blankByChoice: boolean;
  assigneeId: string | null;
  answer: {
    id: string;
    text: string;
    status: AnswerStatus;
    revision: number;
    creatorType: string;
    approvedBy: string | null;
    aiRunId: string | null;
    aiDisposition: AiDisposition | null;
    evidenceStrength: EvidenceStrength | null;
    reviewNote: string | null;
    citations: EvidenceReference[];
  } | null;
};

export type QuestionListFilters = {
  query: string;
  status: "" | AnswerStatus;
  category: string;
  /** "" = everyone, a user id, or "unassigned". */
  assignee: string;
  page: number;
};

export type QuestionListPage = {
  rows: QuestionRow[];
  total: number;
  page: number;
  pageSize: number;
};

const ANSWER_STATUSES: AnswerStatus[] = [
  "empty", "generating", "drafted", "answered", "insufficient_evidence",
  "in_review", "changes_requested", "rejected", "approved",
];

export function parseQuestionFilters(sp: Record<string, string | string[] | undefined>): QuestionListFilters {
  const single = (value: string | string[] | undefined): string =>
    Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  const statusValue = single(sp.status) as AnswerStatus;
  return {
    query: single(sp.q).slice(0, 120),
    status: ANSWER_STATUSES.includes(statusValue) ? statusValue : "",
    category: single(sp.category).slice(0, 80),
    assignee: single(sp.assignee).slice(0, 64),
    page: Math.max(1, Number.parseInt(single(sp.page) || "1", 10) || 1),
  };
}

const QUESTION_SELECT = "id, position, sheet_name, row_number, question_cell, answer_cell, notes_cell, question_original, category, status, blank_by_choice, assignee_id, answers(id, current_text, status, revision, creator_type, approved_by, ai_run_id, ai_disposition, evidence_strength, review_note)" as const;

/** The count query carries the SAME filters as the page query (W3 pattern: filters are inlined per builder). */
async function countQuestions(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  questionnaireId: string,
  filters: QuestionListFilters,
): Promise<number | null> {
  let query = supabase
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("questionnaire_id", questionnaireId);
  if (filters.query.trim() !== "") {
    query = query.ilike("question_normalized", `%${filters.query.trim()}%`);
  }
  if (filters.status !== "") {
    query = query.eq("status", filters.status);
  }
  if (filters.category.trim() !== "") {
    query = query.eq("category", filters.category.trim());
  }
  if (filters.assignee === "unassigned") {
    query = query.is("assignee_id", null);
  } else if (filters.assignee !== "") {
    query = query.eq("assignee_id", filters.assignee);
  }
  const { count, error } = await query;
  if (error !== null) {
    logger.warn("question count query failed", { code: "QUERY_FAILED" });
    return null;
  }
  return count ?? 0;
}

export async function listQuestionsPage(
  organizationId: string,
  questionnaireId: string,
  filters: QuestionListFilters,
): Promise<QuestionListPage> {
  const supabase = await createSupabaseServerClient();

  const total = await countQuestions(supabase, organizationId, questionnaireId, filters);
  if (total === null) {
    return { rows: [], total: 0, page: filters.page, pageSize: QUESTIONS_PAGE_SIZE };
  }

  const offset = (filters.page - 1) * QUESTIONS_PAGE_SIZE;
  let query = supabase
    .from("questions")
    .select(QUESTION_SELECT)
    .eq("organization_id", organizationId)
    .eq("questionnaire_id", questionnaireId);
  if (filters.query.trim() !== "") {
    query = query.ilike("question_normalized", `%${filters.query.trim()}%`);
  }
  if (filters.status !== "") {
    query = query.eq("status", filters.status);
  }
  if (filters.category.trim() !== "") {
    query = query.eq("category", filters.category.trim());
  }
  if (filters.assignee === "unassigned") {
    query = query.is("assignee_id", null);
  } else if (filters.assignee !== "") {
    query = query.eq("assignee_id", filters.assignee);
  }

  const { data, error } = await query
    .order("position", { ascending: true })
    .range(offset, offset + QUESTIONS_PAGE_SIZE - 1);
  if (error !== null || data === null) {
    logger.warn("question list query failed", { code: error === null ? "NO_DATA" : "QUERY_FAILED" });
    return { rows: [], total: 0, page: filters.page, pageSize: QUESTIONS_PAGE_SIZE };
  }

  const rows: QuestionRow[] = data.map((row) => ({
    id: row.id,
    position: row.position,
    sheetName: row.sheet_name,
    rowNumber: row.row_number,
    questionCell: row.question_cell,
    answerCell: row.answer_cell,
    notesCell: row.notes_cell,
    questionOriginal: row.question_original,
    category: row.category,
    status: row.status,
    blankByChoice: row.blank_by_choice,
    assigneeId: row.assignee_id,
    answer: row.answers === null
      ? null
      : {
          id: row.answers.id,
          text: row.answers.current_text,
          status: row.answers.status,
          revision: row.answers.revision,
          creatorType: row.answers.creator_type,
          approvedBy: row.answers.approved_by,
          aiRunId: row.answers.ai_run_id,
          aiDisposition: row.answers.ai_disposition,
          evidenceStrength: row.answers.evidence_strength,
          reviewNote: row.answers.review_note,
          citations: [],
        },
  }));

  return { rows, total, page: filters.page, pageSize: QUESTIONS_PAGE_SIZE };
}

export async function listQuestionCategories(organizationId: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("questions")
    .select("category")
    .eq("organization_id", organizationId)
    .limit(2000);
  if (error !== null) {
    logger.warn("question categories query failed", { code: "QUERY_FAILED" });
    return [];
  }
  return [...new Set((data ?? []).map((row) => row.category))].sort().slice(0, 30);
}

/**
 * Header progress for the data table (plan §W4). Two tiny columns over one
 * questionnaire's questions (imports cap at 1000 rows); the resolved/total
 * math lives in the pure counter so it stays unit tested.
 */
export async function getQuestionnaireProgress(
  organizationId: string,
  questionnaireId: string,
): Promise<QuestionnaireProgress> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("questions")
    .select("status, blank_by_choice")
    .eq("organization_id", organizationId)
    .eq("questionnaire_id", questionnaireId)
    .limit(2000);
  if (error !== null || data === null) {
    logger.warn("question progress query failed", { code: error === null ? "NO_DATA" : "QUERY_FAILED" });
    return { resolved: 0, total: 0 };
  }
  return countQuestionnaireProgress(data);
}

// ---------------------------------------------------------------------------
// Export panel (plan §W6): readiness + history
// ---------------------------------------------------------------------------

export type { ExportHistoryRow, ExportReadiness };

/**
 * Whether the questionnaire can be exported right now (D012/D021/D023 — every
 * question must be a deliberate decision). Computed from the same pure rules
 * the export service enforces, so the panel's blocked copy is never a lie.
 */
export async function getExportReadiness(
  organizationId: string,
  questionnaireId: string,
): Promise<ExportReadiness> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("questions")
    .select("status, blank_by_choice")
    .eq("organization_id", organizationId)
    .eq("questionnaire_id", questionnaireId)
    .limit(2000);
  if (error !== null || data === null) {
    logger.warn("export readiness query failed", { code: error === null ? "NO_DATA" : "QUERY_FAILED" });
    return { total: 0, eligible: 0, unresolved: 0, approved: 0, emptyCellCount: 0 };
  }
  return summarizeExportReadiness(data);
}

/** Newest-first export history (plan §W6), 20 most recent. */
export async function listQuestionnaireExports(
  organizationId: string,
  questionnaireId: string,
): Promise<ExportHistoryRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("questionnaire_exports")
    .select(
      "id, filename, format, byte_size, checksum_sha256, question_count, approved_count, blank_count, exported_by, created_at",
    )
    .eq("organization_id", organizationId)
    .eq("questionnaire_id", questionnaireId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error !== null || data === null) {
    logger.warn("export history query failed", { code: error === null ? "NO_DATA" : "QUERY_FAILED" });
    return [];
  }

  const exporterIds = [...new Set(data.map((row) => row.exported_by).filter((id): id is string => id !== null))];
  const namesById = new Map<string, string>();
  if (exporterIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", exporterIds);
    for (const profile of profiles ?? []) {
      const fullName = profile.full_name.trim();
      if (fullName !== "") {
        namesById.set(profile.id, fullName);
      }
    }
  }

  return data.map((row) => ({
    id: row.id,
    filename: row.filename,
    format: row.format,
    byteSize: row.byte_size,
    checksum: row.checksum_sha256,
    questionCount: row.question_count,
    approvedCount: row.approved_count,
    blankCount: row.blank_count,
    exportedBy: row.exported_by,
    exporterName: row.exported_by === null ? null : (namesById.get(row.exported_by) ?? null),
    createdAt: row.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Progress dashboards (plan §W6): state × category × reviewer
// ---------------------------------------------------------------------------

export type DashboardAssigneeSlice = AssigneeSlice & { assigneeName: string | null };

export type QuestionnaireDashboard = {
  byStatus: StatusSlice[];
  byCategory: CategorySlice[];
  byAssignee: DashboardAssigneeSlice[];
};

/**
 * One fetch over the questionnaire's questions powers all three breakdowns;
 * assignee names resolve through profiles (departed members render null).
 */
export async function getQuestionnaireDashboard(
  organizationId: string,
  questionnaireId: string,
): Promise<QuestionnaireDashboard> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("questions")
    .select("status, blank_by_choice, category, assignee_id")
    .eq("organization_id", organizationId)
    .eq("questionnaire_id", questionnaireId)
    .limit(2000);
  if (error !== null || data === null) {
    logger.warn("dashboard query failed", { code: error === null ? "NO_DATA" : "QUERY_FAILED" });
    return { byStatus: [], byCategory: [], byAssignee: [] };
  }
  const rows = data as DashboardRow[];

  const assigneeIds = [...new Set(rows.map((row) => row.assignee_id).filter((id): id is string => id !== null))];
  const namesById = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", assigneeIds);
    for (const profile of profiles ?? []) {
      const fullName = profile.full_name.trim();
      if (fullName !== "") {
        namesById.set(profile.id, fullName);
      }
    }
  }

  return {
    byStatus: summarizeByStatus(rows),
    byCategory: summarizeByCategory(rows),
    byAssignee: summarizeByAssignee(rows).map((slice) => ({
      ...slice,
      assigneeName: slice.assigneeId === null ? null : (namesById.get(slice.assigneeId) ?? null),
    })),
  };
}

/** Assignee candidates: O/A/R members only (the RPC rejects viewers/outsiders). */
export async function listAssignableMembers(): Promise<Array<{ userId: string; label: string }>> {
  const members = await listMembers();
  return members
    .filter((member) => member.role === "owner" || member.role === "admin" || member.role === "reviewer")
    .map((member) => ({
      userId: member.userId,
      label: member.fullName !== "" ? `${member.fullName} (${member.role})` : (member.email !== "" ? member.email : member.role),
    }));
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export type CommentRow = {
  id: string;
  questionId: string;
  parentId: string | null;
  body: string;
  authorId: string;
  authorName: string | null;
  createdAt: string;
};

export async function listCommentsForQuestions(
  questionIds: string[],
): Promise<Record<string, CommentRow[]>> {
  if (questionIds.length === 0) {
    return {};
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comments")
    .select("id, question_id, parent_id, body, author_id, created_at")
    .in("question_id", questionIds)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error !== null || data === null) {
    logger.warn("comments query failed", { code: error === null ? "NO_DATA" : "QUERY_FAILED" });
    return {};
  }

  const authorIds = [...new Set(data.map((row) => row.author_id).filter((id): id is string => id !== null))];
  const namesById = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds);
    for (const profile of profiles ?? []) {
      const fullName = profile.full_name.trim();
      if (fullName !== "") {
        namesById.set(profile.id, fullName);
      }
    }
  }

  const byQuestion: Record<string, CommentRow[]> = {};
  for (const row of data) {
    const list = byQuestion[row.question_id] ?? [];
    list.push({
      id: row.id,
      questionId: row.question_id,
      parentId: row.parent_id,
      body: row.body,
      authorId: row.author_id ?? "",
      authorName: row.author_id === null ? null : (namesById.get(row.author_id) ?? null),
      createdAt: row.created_at,
    });
    byQuestion[row.question_id] = list;
  }
  return byQuestion;
}
