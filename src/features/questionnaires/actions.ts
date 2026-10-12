"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import type { Database } from "@/types/database.types";
import { extractQuestions } from "@/lib/files/questionnaire/extract";
import { getMappingPreview } from "@/features/questionnaires/server";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  answerStatusActionSchema,
  answerTextSchema,
  commentBodySchema,
  confirmMappingSchema,
  questionCategorySchema,
  questionIdsSchema,
} from "@/lib/validation/questionnaire";
import { requireOrgRole } from "@/server/authorization/org";

/**
 * Questionnaire workflow actions (plan §W4): mapping confirmation (MANDATORY
 * user consent — detection output only ever prefills the preview), autosave
 * answers with revision conflicts, answer status transitions, per-question
 * category edits, bulk table operations, and comments.
 *
 * Every action re-checks role via requireOrgRole and re-validates its inputs
 * with Zod; the SECURITY DEFINER RPC family re-checks membership and tenancy
 * again (migrations 0010–0013), so a forged request fails in the database
 * even if the UI were bypassed. Autosave deliberately does NOT revalidate —
 * re-rendering the table on each keystroke save would destroy input focus;
 * the editor reflects its own state and row badges refresh with the next
 * navigation/transition.
 */

export type MappingActionResult =
  | { status: "success"; questionCount: number }
  | { status: "error"; code: string };

export type SaveAnswerResult =
  | { status: "saved"; revision: number }
  | { status: "conflict" }
  | { status: "error"; code: string };

export type FormActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Mapping confirmation — importing/mapping → active, one user consent
// ---------------------------------------------------------------------------

export async function confirmMappingAction(
  orgSlug: string,
  rawInput: unknown,
): Promise<MappingActionResult> {
  const parsed = confirmMappingSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { status: "error", code: "MAPPING_INPUT_INVALID" };
  }
  const ctx = await requireOrgRole(["owner", "admin", "reviewer"], orgSlug);
  const input = parsed.data;

  // Re-download + re-inspect the STORED original: the import is built from
  // the bytes on record, never from client-supplied question text.
  const preview = await getMappingPreview(ctx.organization.id, input.questionnaireId);
  if (preview === null) {
    return { status: "error", code: "QUESTIONNAIRE_NOT_FOUND" };
  }
  if (preview === "STORAGE_UNAVAILABLE") {
    return { status: "error", code: "WORKBOOK_PARSE_FAILED" };
  }
  if (preview.detail.questionnaire.status !== "importing" && preview.detail.questionnaire.status !== "mapping") {
    return { status: "error", code: "QUESTIONNAIRE_STATE_INVALID" };
  }

  const extraction = extractQuestions(preview.inspection, {
    sheetName: input.sheetName,
    headerRowIndex: input.headerRowIndex,
    questionColumn: input.questionColumn,
    answerColumn: input.answerColumn,
    notesColumn: input.notesColumn,
  });
  if (!extraction.ok) {
    return { status: "error", code: extraction.code };
  }

  const supabase = await createSupabaseServerClient();

  // One-way latch: importing → mapping (no-op failure mode is "already
  // mapping", which confirm accepts — the two together are the consent gate).
  if (preview.detail.questionnaire.status === "importing") {
    const { error: markError } = await supabase.rpc("mark_questionnaire_mapping", {
      p_organization_id: ctx.organization.id,
      p_questionnaire_id: input.questionnaireId,
    });
    if (markError !== null) {
      logger.warn("mapping mark denied", { code: markError.message.slice(0, 40) });
      return { status: "error", code: mapRpcError(markError.message) };
    }
  }

  const { data: count, error: confirmError } = await supabase.rpc("confirm_questionnaire_mapping", {
    p_organization_id: ctx.organization.id,
    p_questionnaire_id: input.questionnaireId,
    p_questions: extraction.questions,
    p_parser_version: preview.parserVersion,
  });
  if (confirmError !== null) {
    logger.warn("mapping confirm denied", { code: confirmError.message.slice(0, 40) });
    return { status: "error", code: mapRpcError(confirmError.message) };
  }

  revalidatePath(`/app/${orgSlug}/questionnaires/${input.questionnaireId}`);
  revalidatePath(`/app/${orgSlug}/questionnaires`);
  return { status: "success", questionCount: typeof count === "number" ? count : extraction.questions.length };
}

// ---------------------------------------------------------------------------
// Answers: autosave + status transitions
// ---------------------------------------------------------------------------

export async function saveAnswerAction(
  orgSlug: string,
  questionId: string,
  expectedRevision: number | null,
  rawText: unknown,
): Promise<SaveAnswerResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(questionId)) {
    return { status: "error", code: "QUESTION_NOT_FOUND" };
  }
  if (expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
    return { status: "error", code: "ANSWER_INPUT_INVALID" };
  }
  const parsed = answerTextSchema.safeParse(rawText);
  if (!parsed.success) {
    return { status: "error", code: "ANSWER_INPUT_INVALID" };
  }
  const ctx = await requireOrgRole(["owner", "admin", "reviewer"], orgSlug);

  const supabase = await createSupabaseServerClient();
  // Generated types cannot express a NULLABLE integer parameter — one narrow,
  // reviewed assertion for the genuine-create NULL path (see upload route).
  const args = {
    p_organization_id: ctx.organization.id,
    p_question_id: questionId,
    p_text: parsed.data,
    p_expected_revision: expectedRevision,
  } as Database["public"]["Functions"]["save_answer"]["Args"];
  const { data: revision, error } = await supabase.rpc("save_answer", args);
  if (error !== null) {
    logger.warn("answer save denied", { code: error.message.slice(0, 40) });
    const code = mapRpcError(error.message);
    return code === "ANSWER_CONFLICT" ? { status: "conflict" } : { status: "error", code };
  }
  return { status: "saved", revision: typeof revision === "number" ? revision : expectedRevision ?? 1 };
}

export async function setAnswerStatusAction(
  orgSlug: string,
  questionnaireId: string,
  questionId: string,
  expectedRevision: number,
  rawStatus: unknown,
): Promise<SaveAnswerResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(questionId)) {
    return { status: "error", code: "QUESTION_NOT_FOUND" };
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return { status: "error", code: "ANSWER_CONFLICT" };
  }
  const parsed = answerStatusActionSchema.safeParse(rawStatus);
  if (!parsed.success) {
    return { status: "error", code: "ANSWER_TRANSITION_INVALID" };
  }
  const ctx = await requireOrgRole(["owner", "admin", "reviewer"], orgSlug);

  const supabase = await createSupabaseServerClient();
  const args = {
    p_organization_id: ctx.organization.id,
    p_question_id: questionId,
    p_status: parsed.data,
    p_expected_revision: expectedRevision,
  } as Database["public"]["Functions"]["set_answer_status"]["Args"];
  const { data: revision, error } = await supabase.rpc("set_answer_status", args);
  if (error !== null) {
    logger.warn("answer status change denied", { code: error.message.slice(0, 40) });
    const code = mapRpcError(error.message);
    return code === "ANSWER_CONFLICT" ? { status: "conflict" } : { status: "error", code };
  }

  revalidatePath(`/app/${orgSlug}/questionnaires/${questionnaireId}`);
  return { status: "saved", revision: typeof revision === "number" ? revision : expectedRevision + 1 };
}

// ---------------------------------------------------------------------------
// Per-question category (plan §W4 data table: category is editable, not
// just a filter — the update_question_category RPC ships in migration 0010)
// ---------------------------------------------------------------------------

export type CategoryUpdateResult = { status: "saved" } | { status: "error"; code: string };

export async function updateQuestionCategoryAction(
  orgSlug: string,
  questionnaireId: string,
  questionId: string,
  rawCategory: unknown,
): Promise<CategoryUpdateResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(questionId)) {
    return { status: "error", code: "QUESTION_NOT_FOUND" };
  }
  const parsed = questionCategorySchema.safeParse(rawCategory);
  if (!parsed.success) {
    return { status: "error", code: "QUESTION_INPUT_INVALID" };
  }
  const ctx = await requireOrgRole(["owner", "admin", "reviewer"], orgSlug);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_question_category", {
    p_organization_id: ctx.organization.id,
    p_question_id: questionId,
    p_category: parsed.data,
  });
  if (error !== null) {
    logger.warn("category update denied", { code: error.message.slice(0, 40) });
    return { status: "error", code: mapRpcError(error.message) };
  }

  revalidatePath(`/app/${orgSlug}/questionnaires/${questionnaireId}`);
  return { status: "saved" };
}

// ---------------------------------------------------------------------------
// Bulk table operations (form actions)
// ---------------------------------------------------------------------------

function questionIdsFrom(formData: FormData): string[] | null {
  const parsed = questionIdsSchema.safeParse(formData.getAll("questionIds"));
  return parsed.success ? parsed.data : null;
}

export async function bulkAssignAction(
  orgSlug: string,
  questionnaireId: string,
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const ctx = await requireOrgRole(["owner", "admin", "reviewer"], orgSlug);
  const ids = questionIdsFrom(formData);
  if (ids === null) {
    return { status: "error", message: "Select at least one question first." };
  }
  const assigneeRaw = formData.get("assigneeId");
  const assigneeId = typeof assigneeRaw === "string" && assigneeRaw.trim() !== "" ? assigneeRaw.trim() : null;
  if (assigneeId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assigneeId)) {
    return { status: "error", message: "That assignee isn't valid." };
  }

  const supabase = await createSupabaseServerClient();
  // Generated types cannot express a NULLABLE uuid parameter (`p_assignee_id`
  // is typed bare `string`; the SQL accepts NULL = unassign) — one narrow,
  // reviewed assertion (same documented limitation as the upload route).
  const args = {
    p_organization_id: ctx.organization.id,
    p_question_ids: ids,
    p_assignee_id: assigneeId,
  } as Database["public"]["Functions"]["set_question_assignee"]["Args"];
  const { error } = await supabase.rpc("set_question_assignee", args);
  if (error !== null) {
    logger.warn("bulk assign denied", { code: error.message.slice(0, 40) });
    return { status: "error", message: "The assignment failed — every selected question must still exist." };
  }

  revalidatePath(`/app/${orgSlug}/questionnaires/${questionnaireId}`);
  return { status: "success", message: `Assigned ${ids.length} question${ids.length === 1 ? "" : "s"}.` };
}

export async function bulkBlankByChoiceAction(
  orgSlug: string,
  questionnaireId: string,
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const ctx = await requireOrgRole(["owner", "admin", "reviewer"], orgSlug);
  const ids = questionIdsFrom(formData);
  if (ids === null) {
    return { status: "error", message: "Select at least one question first." };
  }
  const valueRaw = formData.get("blankValue");
  const value = valueRaw === "true";
  if (typeof valueRaw !== "string" || (valueRaw !== "true" && valueRaw !== "false")) {
    return { status: "error", message: "That toggle isn't valid." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_question_blank_by_choice", {
    p_organization_id: ctx.organization.id,
    p_question_ids: ids,
    p_value: value,
  });
  if (error !== null) {
    logger.warn("blank-by-choice toggle denied", { code: error.message.slice(0, 40) });
    return { status: "error", message: "The update failed — every selected question must still exist." };
  }

  revalidatePath(`/app/${orgSlug}/questionnaires/${questionnaireId}`);
  return {
    status: "success",
    message: value
      ? `Marked ${ids.length} question${ids.length === 1 ? "" : "s"} as consciously blank.`
      : `Cleared the blank marker on ${ids.length} question${ids.length === 1 ? "" : "s"}.`,
  };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function addCommentAction(
  orgSlug: string,
  questionnaireId: string,
  questionId: string,
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const ctx = await requireOrgRole(["owner", "admin", "reviewer"], orgSlug);
  const parsed = commentBodySchema.safeParse(formData.get("body"));
  if (!parsed.success) {
    return { status: "error", message: "Comments must contain text (max 2,000 characters)." };
  }

  const supabase = await createSupabaseServerClient();
  const userId = await getCurrentUserId(supabase);
  // The INSERT policy requires author_id = auth.uid() — a forged author (or a
  // null one) is rejected by the database even before RLS tenancy checks.
  const { error } = await supabase.from("comments").insert({
    organization_id: ctx.organization.id,
    question_id: questionId,
    author_id: userId,
    body: parsed.data,
  });
  if (error !== null) {
    logger.warn("comment insert denied", { code: error.message.slice(0, 40) });
    return { status: "error", message: "The comment could not be added." };
  }

  revalidatePath(`/app/${orgSlug}/questionnaires/${questionnaireId}`);
  return { status: "success", message: "Comment added." };
}

export async function deleteCommentAction(
  orgSlug: string,
  questionnaireId: string,
  formData: FormData,
): Promise<void> {
  await requireOrgRole(["owner", "admin", "reviewer", "viewer"], orgSlug);
  const commentId = formData.get("commentId");
  if (typeof commentId !== "string" || commentId === "") {
    return;
  }
  const supabase = await createSupabaseServerClient();
  // RLS: author-or-owner/admin delete policy (migration 0010) — anyone else's
  // delete is silently a no-op at the database.
  await supabase.from("comments").delete().eq("id", commentId);
  revalidatePath(`/app/${orgSlug}/questionnaires/${questionnaireId}`);
}

// ---------------------------------------------------------------------------
// Bulk review (plan §W6 "bulk review where safe") — strict pre-states,
// all-or-nothing; the RPC re-decides every row server-side (migration 0018).
// ---------------------------------------------------------------------------

const BULK_REVIEW_TARGETS = ["in_review", "approved", "changes_requested", "rejected"] as const;
type BulkReviewTarget = (typeof BULK_REVIEW_TARGETS)[number];

export async function bulkReviewAction(
  orgSlug: string,
  questionnaireId: string,
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const ctx = await requireOrgRole(["owner", "admin", "reviewer"], orgSlug);
  const ids = questionIdsFrom(formData);
  if (ids === null) {
    return { status: "error", message: "Select at least one question first." };
  }
  const targetRaw = formData.get("reviewTarget");
  if (typeof targetRaw !== "string" || !BULK_REVIEW_TARGETS.includes(targetRaw as BulkReviewTarget)) {
    return { status: "error", message: "That review action isn't valid here." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: updated, error } = await supabase.rpc("bulk_set_answer_status", {
    p_organization_id: ctx.organization.id,
    p_question_ids: ids,
    p_status: targetRaw as BulkReviewTarget,
  });
  if (error !== null) {
    logger.warn("bulk review denied", { code: error.message.slice(0, 40) });
    return {
      status: "error",
      message: questionnaireCopyForBulk(error.message),
    };
  }

  revalidatePath(`/app/${orgSlug}/questionnaires/${questionnaireId}`);
  const moved = typeof updated === "number" ? updated : ids.length;
  return {
    status: "success",
    message: `${moved} answer${moved === 1 ? "" : "s"} moved to ${labelFor(targetRaw as BulkReviewTarget)}.`,
  };
}

function questionnaireCopyForBulk(message: string): string {
  if (message.includes("ANSWER_BULK_STATE_CHANGED")) {
    return "Some answers changed while you were working — nothing was applied. Reload and try again.";
  }
  if (message.includes("FORBIDDEN")) {
    return "You don't have permission to review here.";
  }
  return "The bulk review failed. Reload and try again.";
}

function labelFor(target: BulkReviewTarget): string {
  const labels: Record<BulkReviewTarget, string> = {
    in_review: "in review",
    approved: "approved",
    changes_requested: "changes requested",
    rejected: "rejected",
  };
  return labels[target];
}

// ---------------------------------------------------------------------------
// Questionnaire lifecycle + reviewer assignment (plan §W6; migration 0018)
// ---------------------------------------------------------------------------

const LIFECYCLE_TARGETS = ["in_review", "active", "completed"] as const;
type LifecycleTarget = (typeof LIFECYCLE_TARGETS)[number];

export type LifecycleActionResult =
  | { status: "success"; target: string }
  | { status: "error"; code: string };

export async function setQuestionnaireStatusAction(
  orgSlug: string,
  questionnaireId: string,
  formData: FormData,
): Promise<void> {
  const targetRaw = formData.get("targetStatus");
  if (typeof targetRaw !== "string" || !LIFECYCLE_TARGETS.includes(targetRaw as LifecycleTarget)) {
    return;
  }
  const ctx = await requireOrgRole(["owner", "admin", "reviewer"], orgSlug);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_questionnaire_status", {
    p_organization_id: ctx.organization.id,
    p_questionnaire_id: questionnaireId,
    p_status: targetRaw as LifecycleTarget,
  });
  if (error !== null) {
    logger.warn("lifecycle transition denied", { code: error.message.slice(0, 40) });
  }

  revalidatePath(`/app/${orgSlug}/questionnaires/${questionnaireId}`);
  revalidatePath(`/app/${orgSlug}/questionnaires`);
  revalidatePath(`/app/${orgSlug}/review`);
}

export async function setQuestionnaireReviewerAction(
  orgSlug: string,
  questionnaireId: string,
  formData: FormData,
): Promise<void> {
  const ctx = await requireOrgRole(["owner", "admin", "reviewer"], orgSlug);
  const reviewerRaw = formData.get("reviewerId");
  const reviewerId = typeof reviewerRaw === "string" && reviewerRaw.trim() !== "" ? reviewerRaw.trim() : null;
  if (reviewerId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reviewerId)) {
    return;
  }

  const supabase = await createSupabaseServerClient();
  // Generated types cannot express a NULLABLE uuid parameter (documented
  // limitation; the SQL accepts NULL = unassign).
  const args = {
    p_organization_id: ctx.organization.id,
    p_questionnaire_id: questionnaireId,
    p_reviewer_id: reviewerId,
  } as Database["public"]["Functions"]["set_questionnaire_reviewer"]["Args"];
  const { error } = await supabase.rpc("set_questionnaire_reviewer", args);
  if (error !== null) {
    logger.warn("reviewer assignment denied", { code: error.message.slice(0, 40) });
  }

  revalidatePath(`/app/${orgSlug}/questionnaires/${questionnaireId}`);
}

// ---------------------------------------------------------------------------
// Questionnaire lifecycle (list page)
// ---------------------------------------------------------------------------

export async function deleteQuestionnaireAction(orgSlug: string, formData: FormData): Promise<void> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const questionnaireId = formData.get("questionnaireId");
  if (typeof questionnaireId !== "string" || questionnaireId === "") {
    return;
  }
  const supabase = await createSupabaseServerClient();

  const { data: file } = await supabase
    .from("questionnaire_files")
    .select("storage_path")
    .eq("questionnaire_id", questionnaireId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();

  // Export objects are ordinary bucket objects (0018) — the DB rows cascade,
  // the bytes do not, so they are collected for cleanup with the original.
  const { data: exportPaths } = await supabase
    .from("questionnaire_exports")
    .select("storage_path")
    .eq("questionnaire_id", questionnaireId)
    .eq("organization_id", ctx.organization.id);

  const { error } = await supabase
    .from("questionnaires")
    .delete()
    .eq("id", questionnaireId)
    .eq("organization_id", ctx.organization.id);
  if (error !== null) {
    return;
  }

  const storagePaths = [
    ...(file !== null ? [file.storage_path] : []),
    ...(exportPaths ?? []).map((row) => row.storage_path),
  ];
  if (storagePaths.length > 0) {
    const { error: storageError } = await supabase.storage.from("questionnaires").remove(storagePaths);
    if (storageError !== null) {
      logger.warn("questionnaire storage cleanup failed", { count: storagePaths.length });
    }
  }

  revalidatePath(`/app/${orgSlug}/questionnaires`);
  redirect(`/app/${orgSlug}/questionnaires`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getCurrentUserId(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

function mapRpcError(message: string): string {
  const code = message.trim();
  const known = [
    "ANSWER_CONFLICT",
    "ANSWER_TRANSITION_INVALID",
    "ANSWER_INPUT_INVALID",
    "ANSWER_NOT_FOUND",
    "QUESTION_NOT_FOUND",
    "QUESTIONNAIRE_STATE_INVALID",
    "QUESTIONNAIRE_NOT_FOUND",
    "MAPPING_INPUT_INVALID",
    "MAPPING_DUPLICATE_CELL",
    "ORG_INACTIVE",
    "QUOTA_EXCEEDED",
    "FORBIDDEN",
    "AUTH_REQUIRED",
  ];
  const match = known.find((candidate) => code.includes(candidate));
  return match ?? "UPLOAD_FAILED";
}
