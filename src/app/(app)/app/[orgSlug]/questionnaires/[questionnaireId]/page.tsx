import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, MessageSquare, Search, Trash2 } from "lucide-react";

import { AccessDenied } from "@/components/feedback/access-denied";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deleteCommentAction } from "@/features/questionnaires/actions";
import { BULK_FORM_ID, STATUS_LABELS } from "@/features/questionnaires/constants";
import { BulkBar } from "@/features/questionnaires/components/bulk-bar";
import { CategoryEditor } from "@/features/questionnaires/components/category-editor";
import { CommentForm } from "@/features/questionnaires/components/comment-form";
import { AnswerVersionHistory } from "@/features/questionnaires/components/answer-version-history";
import { QuestionWorkspace } from "@/features/questionnaires/components/question-workspace";
import { ReviewPanel } from "@/features/questionnaires/components/review-panel";
import { QuestionnaireDashboard } from "@/features/questionnaires/components/questionnaire-dashboard";
import {
  AnswerRunControls,
  GenerateDraftButton,
} from "@/features/questionnaires/components/answer-run-controls";
import { ExportPanel } from "@/features/questionnaires/components/export-panel";
import { getAnswerAvailability } from "@/lib/ai/answer-provider";
import {
  getLatestAnswerRunSnapshot,
  listAnswerEvidence,
} from "@/features/questionnaires/ai-server";
import type { EvidenceReference } from "@/features/questionnaires/ai-types";
import {
  getExportReadiness,
  getQuestionnaireDashboard,
  getQuestionnaireDetail,
  getQuestionnaireProgress,
  listAssignableMembers,
  listCommentsForQuestions,
  listQuestionCategories,
  listQuestionnaireExports,
  listQuestionsPage,
  parseQuestionFilters,
  type CommentRow,
  type QuestionnaireProgress,
  type QuestionRow as QuestionRowModel,
} from "@/features/questionnaires/server";
import { requireUser } from "@/server/auth/session";
import { guardOrgRoles } from "@/server/authorization/guard";

/**
 * Questionnaire workspace (plan §W4): the question data table — search,
 * status/category/assignee filters, pagination, bulk assignment and
 * blank-by-choice, per-question answers with autosave + revision conflicts,
 * per-question category editing, header progress, review transitions, and
 * threaded comments.
 *
 * All rows render server-side; only the small interactive islands (answer
 * editor, review buttons, comment form, bulk bar) hydrate. Viewers get the
 * exact same table read-only — the permission matrix is enforced again by
 * every RPC.
 */

// Muted-badge text uses neutral-700/300 rather than text-muted-foreground:
// #737373 on bg-muted is 4.34:1 — below the WCAG AA 4.5:1 threshold at 12px.
const MUTED_BADGE = "bg-muted text-neutral-700 dark:text-neutral-300";

const STATUS_BADGES: Record<string, string> = {
  empty: MUTED_BADGE,
  generating: MUTED_BADGE,
  drafted: MUTED_BADGE,
  answered: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  insufficient_evidence: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  in_review: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  changes_requested: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-400",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

// The questionnaire LIFECYCLE badge is a different enum — do not reuse the
// answer-status map (an "active" questionnaire would fall into the fallback).
const QUESTIONNAIRE_BADGES: Record<string, string> = {
  importing: MUTED_BADGE,
  mapping: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  in_review: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  exported: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  archived: MUTED_BADGE,
};

const FILTER_STATUSES = ["empty", "answered", "in_review", "changes_requested", "rejected", "approved"] as const;

const FILTER_STATUS_LABELS: Record<(typeof FILTER_STATUSES)[number], string> = {
  empty: "Not answered",
  answered: "Answered",
  in_review: "In review",
  changes_requested: "Changes requested",
  rejected: "Rejected",
  approved: "Approved",
};

export default async function QuestionnairePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; questionnaireId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgSlug, questionnaireId } = await params;
  const sp = await searchParams;
  const filters = parseQuestionFilters(sp);

  const guard = await guardOrgRoles(orgSlug, ["owner", "admin", "reviewer", "viewer"]);
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return null;
    }
    if (guard.reason === "forbidden") {
      return <AccessDenied what="this workspace" />;
    }
    notFound();
  }

  const detail = await getQuestionnaireDetail(guard.ctx.organization.id, questionnaireId);
  if (detail === null) {
    notFound();
  }
  const { questionnaire, file } = detail;
  const canEdit = guard.ctx.role === "owner" || guard.ctx.role === "admin" || guard.ctx.role === "reviewer";
  const canManage = guard.ctx.role === "owner" || guard.ctx.role === "admin";
  const importIncomplete = questionnaire.status === "importing" || questionnaire.status === "mapping";

  const [page, categories, members, user, progress, latestRun, readiness, exports, dashboard] = await Promise.all([
    listQuestionsPage(guard.ctx.organization.id, questionnaireId, filters),
    listQuestionCategories(guard.ctx.organization.id),
    canEdit ? listAssignableMembers() : Promise.resolve([]),
    requireUser(),
    getQuestionnaireProgress(guard.ctx.organization.id, questionnaireId),
    canEdit ? getLatestAnswerRunSnapshot(guard.ctx.organization.id, questionnaireId) : Promise.resolve(null),
    getExportReadiness(guard.ctx.organization.id, questionnaireId),
    listQuestionnaireExports(guard.ctx.organization.id, questionnaireId),
    getQuestionnaireDashboard(guard.ctx.organization.id, questionnaireId),
  ]);
  const comments = page.rows.length > 0 ? await listCommentsForQuestions(page.rows.map((row) => row.id)) : {};
  const evidenceByAnswer = await listAnswerEvidence(
    guard.ctx.organization.id,
    page.rows.flatMap((row) => row.answer === null ? [] : [row.answer.id]),
  );
  const rows = page.rows.map((row) => row.answer === null
    ? row
    : {
        ...row,
        answer: {
          ...row.answer,
          citations: evidenceByAnswer[row.answer.id] ?? [],
        },
      });
  const answerAvailability = getAnswerAvailability();
  const questionnaireReady = questionnaire.status === "active"
    || questionnaire.status === "in_review"
    || questionnaire.status === "completed";

  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));
  const rangeStart = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const rangeEnd = Math.min(page.total, page.page * page.pageSize);
  const filterParams = new URLSearchParams();
  if (filters.query !== "") filterParams.set("q", filters.query);
  if (filters.status !== "") filterParams.set("status", filters.status);
  if (filters.category !== "") filterParams.set("category", filters.category);
  if (filters.assignee !== "") filterParams.set("assignee", filters.assignee);
  const pageHref = (targetPage: number): string => {
    const clone = new URLSearchParams(filterParams);
    clone.set("page", String(targetPage));
    return `?${clone.toString()}`;
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6">
      <div>
        <Link href={`/app/${orgSlug}/questionnaires`} className="text-muted-foreground text-sm hover:underline">
          ← All questionnaires
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{questionnaire.title}</h1>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${QUESTIONNAIRE_BADGES[questionnaire.status] ?? QUESTIONNAIRE_BADGES.importing}`}>
            {questionnaire.status}
          </span>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {questionnaire.customer !== "" ? `${questionnaire.customer} · ` : ""}
          {`${page.total} question${page.total === 1 ? "" : "s"}`}
          {questionnaire.due_date !== null
            ? ` · due ${new Date(`${questionnaire.due_date}T00:00:00`).toLocaleDateString()}`
            : ""}
          {detail.assignedReviewerName !== null ? ` · reviewer ${detail.assignedReviewerName}` : ""}
          {file !== null
            ? ` · ${file.format.toUpperCase()} ${(file.byte_size / 1024).toFixed(0)} KB`
            : ""}
          {file?.parser_version !== null && file !== null ? ` · parsed ${file.parser_version}` : ""}
        </p>
        {progress.total > 0 ? (
          <QuestionnaireProgressMeter progress={progress} />
        ) : null}
        {canEdit ? (
          <AnswerRunControls
            orgSlug={orgSlug}
            questionnaireId={questionnaireId}
            initialRun={latestRun}
            availability={answerAvailability}
            questionnaireReady={questionnaireReady}
          />
        ) : null}
        {importIncomplete ? (
          <Card className="mt-4">
            <CardContent className="py-4">
              <p className="text-sm">
                This questionnaire has no questions yet — finish the column mapping to import them.
              </p>
              {canEdit ? (
                <Link
                  href={`/app/${orgSlug}/questionnaires/${questionnaireId}/mapping`}
                  className="text-primary mt-2 inline-block text-sm underline"
                >
                  Continue mapping →
                </Link>
              ) : (
                <p className="text-muted-foreground mt-1 text-xs">
                  Owners, admins, and reviewers can finish the import.
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
        {!importIncomplete ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ReviewPanel
              orgSlug={orgSlug}
              questionnaireId={questionnaireId}
              status={questionnaire.status}
              members={members}
              assignedReviewerId={questionnaire.assigned_reviewer}
              canReview={canEdit}
              allResolved={readiness.unresolved === 0 && readiness.total > 0}
            />
            <ExportPanel
              orgSlug={orgSlug}
              questionnaireId={questionnaireId}
              format={file?.format === "csv" ? "csv" : "xlsx"}
              questionnaireStatus={questionnaire.status}
              readiness={readiness}
              history={exports}
              canExport={canEdit}
            />
          </div>
        ) : null}
        {!importIncomplete && readiness.total > 0 ? (
          <QuestionnaireDashboard dashboard={dashboard} />
        ) : null}
      </div>

      {page.total === 0 && !importIncomplete && filters.query === "" && filters.status === "" && filters.category === "" && filters.assignee === "" ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground text-sm">
              No questions were imported from this file. Re-import with a questions column that contains text.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {page.total > 0 || filters.query !== "" || filters.status !== "" || filters.category !== "" || filters.assignee !== "" ? (
        <>
          <form method="get" className="flex flex-wrap items-end gap-2" role="search">
            <div className="grid gap-1.5">
              <label className="sr-only" htmlFor="question-search">
                Search questions
              </label>
              <div className="relative">
                <Search aria-hidden="true" className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
                <Input
                  id="question-search"
                  name="q"
                  defaultValue={filters.query}
                  placeholder="Search questions…"
                  className="pl-8 sm:w-64"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="sr-only" htmlFor="filter-status">
                Status
              </label>
              <select
                id="filter-status"
                name="status"
                defaultValue={filters.status}
                className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
              >
                <option value="">All statuses</option>
                {FILTER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {FILTER_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <label className="sr-only" htmlFor="filter-category">
                Category
              </label>
              <select
                id="filter-category"
                name="category"
                defaultValue={filters.category}
                className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            {canEdit ? (
              <div className="grid gap-1.5">
                <label className="sr-only" htmlFor="filter-assignee">
                  Assignee
                </label>
                <select
                  id="filter-assignee"
                  name="assignee"
                  defaultValue={filters.assignee}
                  className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
                >
                  <option value="">All assignees</option>
                  <option value="unassigned">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <Button type="submit" variant="outline">
              Filter
            </Button>
            {filterParams.size > 0 ? (
              <Link
                href={`/app/${orgSlug}/questionnaires/${questionnaireId}`}
                className="text-muted-foreground self-center text-sm hover:underline"
              >
                Clear
              </Link>
            ) : null}
          </form>

          {canEdit ? (
            <BulkBar orgSlug={orgSlug} questionnaireId={questionnaireId} members={members}>
              <QuestionTable
                rows={rows}
                comments={comments}
                orgSlug={orgSlug}
                questionnaireId={questionnaireId}
                canEdit={canEdit}
                canManage={canManage}
                currentUserId={user.userId}
                availability={answerAvailability}
                questionnaireReady={questionnaireReady}
              />
            </BulkBar>
          ) : (
            <QuestionTable
              rows={rows}
              comments={comments}
              orgSlug={orgSlug}
              questionnaireId={questionnaireId}
              canEdit={canEdit}
              canManage={canManage}
              currentUserId={user.userId}
              availability={answerAvailability}
              questionnaireReady={questionnaireReady}
            />
          )}

          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">
              {page.total === 0
                ? "No questions match these filters."
                : `Showing ${rangeStart}–${rangeEnd} of ${page.total}`}
            </p>
            {totalPages > 1 ? (
              <div className="flex items-center gap-2">
                {page.page > 1 ? (
                  <Link href={pageHref(page.page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    <ChevronLeft aria-hidden="true" /> Previous
                  </Link>
                ) : null}
                <span className="text-muted-foreground text-sm">
                  Page {page.page} of {totalPages}
                </span>
                {page.page < totalPages ? (
                  <Link href={pageHref(page.page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Next <ChevronRight aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress meter (dataviz meter spec: single hue over a lighter step of the
// same ramp; the visible count text is the accessible channel, so the bar is
// decorative — value/state never rides on color alone)
// ---------------------------------------------------------------------------

function QuestionnaireProgressMeter({ progress }: { progress: QuestionnaireProgress }) {
  const percent = progress.total === 0 ? 0 : Math.round((progress.resolved / progress.total) * 100);
  return (
    <div className="mt-2 flex items-center gap-3">
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {progress.resolved} of {progress.total} resolved
      </p>
      <div aria-hidden="true" className="bg-blue-500/15 h-2 w-40 overflow-hidden rounded-full">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table (server-rendered rows; islands for the interactive cells)
// ---------------------------------------------------------------------------

function QuestionTable({
  rows,
  comments,
  orgSlug,
  questionnaireId,
  canEdit,
  canManage,
  currentUserId,
  availability,
  questionnaireReady,
}: {
  rows: QuestionRowModel[];
  comments: Record<string, CommentRow[]>;
  orgSlug: string;
  questionnaireId: string;
  canEdit: boolean;
  canManage: boolean;
  currentUserId: string;
  availability: ReturnType<typeof getAnswerAvailability>;
  questionnaireReady: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Questions with answers, statuses, and comments</caption>
        <thead>
          <tr className="border-b bg-muted/40 text-left">
            {canEdit ? (
              <th scope="col" className="w-10 px-3 py-2">
                <span className="sr-only">Select</span>
              </th>
            ) : null}
            <th scope="col" className="px-3 py-2 font-medium">
              Question
            </th>
            <th scope="col" className="w-40 px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="w-32 px-3 py-2 font-medium">
              Category
            </th>
            <th scope="col" className="w-12 px-3 py-2 font-medium">
              <span className="sr-only">Answer details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const questionComments = comments[row.id] ?? [];
            return (
              <FragmentRow
                key={row.id}
                row={row}
                comments={questionComments}
                orgSlug={orgSlug}
                questionnaireId={questionnaireId}
                canEdit={canEdit}
                canManage={canManage}
                currentUserId={currentUserId}
                availability={availability}
                questionnaireReady={questionnaireReady}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({
  row,
  comments,
  orgSlug,
  questionnaireId,
  canEdit,
  canManage,
  currentUserId,
  availability,
  questionnaireReady,
}: {
  row: QuestionRowModel;
  comments: CommentRow[];
  orgSlug: string;
  questionnaireId: string;
  canEdit: boolean;
  canManage: boolean;
  currentUserId: string;
  availability: ReturnType<typeof getAnswerAvailability>;
  questionnaireReady: boolean;
}) {
  const answer = row.answer;
  const shownStatus = answer === null ? "empty" : answer.status;
  const editorRevision = answer === null ? null : answer.revision;

  return (
    <>
      <tr className="border-b align-top">
        {canEdit ? (
          <td className="px-3 py-3">
            {/* form attribute: joins the bulk toolbar's form remotely — the
                table must NOT live inside a form (the expanded rows contain
                their own comment forms, and nested forms are invalid HTML). */}
            <input
              type="checkbox"
              form={BULK_FORM_ID}
              name="questionIds"
              value={row.id}
              aria-label={`Select question: ${row.questionOriginal.slice(0, 60)}`}
              className="size-4"
            />
          </td>
        ) : null}
        <td className="max-w-xl px-3 py-3">
          <p className="whitespace-pre-wrap">{row.questionOriginal}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {row.sheetName} · {row.questionCell}
            {row.blankByChoice ? " · blank by choice" : ""}
          </p>
        </td>
        <td className="px-3 py-3">
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGES[shownStatus] ?? STATUS_BADGES.empty}`}>
            {STATUS_LABELS[shownStatus] ?? shownStatus}
          </span>
        </td>
        <td className="px-3 py-3 text-muted-foreground text-xs">{row.category}</td>
        <td className="px-3 py-3">
          <details className="group">
            <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-xs">
              <MessageSquare aria-hidden="true" className="size-4" />
              {comments.length > 0 ? comments.length : ""}
              <span className="sr-only">Open answer editor and comments</span>
            </summary>
          </details>
        </td>
      </tr>
      <tr className="border-b bg-muted/20">
        <td colSpan={canEdit ? 5 : 4} className="px-3 py-3 sm:px-10">
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <div className="grid gap-3">
              {canEdit ? (
                // Key includes the server-rendered revision + status: after a
                // transition refresh the island remounts with the fresh truth
                // instead of keeping pre-refresh client state.
                <QuestionWorkspace
                  key={`${row.id}:${String(editorRevision)}:${shownStatus}`}
                  orgSlug={orgSlug}
                  questionnaireId={questionnaireId}
                  questionId={row.id}
                  initialText={answer?.text ?? ""}
                  initialRevision={editorRevision}
                  initialStatus={shownStatus}
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm">
                  {answer?.text ?? "Not answered yet."}
                </p>
              )}
              <AnswerEvidencePanel
                answer={answer}
                orgSlug={orgSlug}
                questionnaireId={questionnaireId}
                questionId={row.id}
                availability={availability}
                questionnaireReady={questionnaireReady}
                canEdit={canEdit}
              />
              {answer !== null ? <AnswerVersionHistory questionId={row.id} /> : null}
              {canEdit ? (
                // Its own island, keyed by the category: remounts only when
                // the server value changed, so autosave-driven remounts of the
                // answer workspace never wipe in-progress category typing.
                <CategoryEditor
                  key={`${row.id}:${row.category}`}
                  orgSlug={orgSlug}
                  questionnaireId={questionnaireId}
                  questionId={row.id}
                  initialCategory={row.category}
                />
              ) : null}
            </div>
            <div className="grid content-start gap-2">
              <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Comments
              </h2>
              {comments.length === 0 ? (
                <p className="text-muted-foreground text-xs">No comments yet.</p>
              ) : (
                <ul className="grid gap-2">
                  {comments.map((comment) => (
                    <li key={comment.id} className="border-border/60 rounded-lg border p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {comment.authorName ?? "Former member"} ·{" "}
                          {new Date(comment.createdAt).toLocaleDateString()}
                        </span>
                        {canManage || comment.authorId === currentUserId ? (
                          <form action={deleteCommentAction.bind(null, orgSlug, questionnaireId)}>
                            <input type="hidden" name="commentId" value={comment.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive size-6"
                              aria-label="Delete comment"
                            >
                              <Trash2 aria-hidden="true" className="size-3.5" />
                            </Button>
                          </form>
                        ) : null}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap">{comment.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              {canEdit ? (
                <CommentForm orgSlug={orgSlug} questionnaireId={questionnaireId} questionId={row.id} />
              ) : null}
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}

type AnswerModel = NonNullable<QuestionRowModel["answer"]>;

function AnswerEvidencePanel({
  answer,
  orgSlug,
  questionnaireId,
  questionId,
  availability,
  questionnaireReady,
  canEdit,
}: {
  answer: AnswerModel | null;
  orgSlug: string;
  questionnaireId: string;
  questionId: string;
  availability: ReturnType<typeof getAnswerAvailability>;
  questionnaireReady: boolean;
  canEdit: boolean;
}) {
  const canGenerate = answer === null
    || (answer.status !== "approved" && answer.status !== "in_review" && answer.status !== "generating");
  const hasAiProvenance = answer !== null && (answer.creatorType === "ai" || answer.aiDisposition !== null);
  const references = answer?.citations ?? [];

  return (
    <div className="border-border/60 grid gap-2 border-t pt-3">
      {canEdit && canGenerate ? (
        <GenerateDraftButton
          orgSlug={orgSlug}
          questionnaireId={questionnaireId}
          questionId={questionId}
          availability={availability}
          questionnaireReady={questionnaireReady}
        />
      ) : null}
      {hasAiProvenance ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {answer.aiDisposition !== null ? (
            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-violet-700 dark:text-violet-400">
              {dispositionLabel(answer.aiDisposition)}
            </span>
          ) : null}
          {answer.evidenceStrength !== null ? (
            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-blue-700 dark:text-blue-400">
              Evidence strength: {answer.evidenceStrength}
            </span>
          ) : null}
        </div>
      ) : null}
      {answer?.aiDisposition === "insufficient_evidence" ? (
        <p className="text-muted-foreground text-xs">
          No approved evidence supported this draft. Write the answer manually or add evidence before trying again.
        </p>
      ) : null}
      {answer?.reviewNote !== null && answer?.reviewNote !== undefined ? (
        <p className="text-muted-foreground text-xs">Review note: {answer.reviewNote}</p>
      ) : null}
      {hasAiProvenance && references.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs font-medium hover:underline">
            Evidence ({references.length})
          </summary>
          <EvidenceList references={references} />
        </details>
      ) : hasAiProvenance && answer?.aiDisposition === "needs_review" ? (
        <p className="text-muted-foreground text-xs">No citation was attached; this draft needs manual review.</p>
      ) : null}
    </div>
  );
}

function EvidenceList({ references }: { references: EvidenceReference[] }) {
  return (
    <ol className="mt-2 grid gap-2">
      {references.map((reference) => (
        <li key={`${reference.sourceType}:${reference.sourceId}`} className="border-border/60 rounded-lg border p-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{reference.title}</span>
            <span className="text-muted-foreground">Retrieval score {reference.retrievalScore.toFixed(2)}</span>
          </div>
          {reference.section !== "" ? <p className="text-muted-foreground mt-1">{reference.section}</p> : null}
          {!reference.available ? (
            <p className="text-muted-foreground mt-1">This source is no longer available to the workspace.</p>
          ) : (
            <>
              {reference.stale ? <p className="mt-1 text-amber-700 dark:text-amber-400">Review date has passed.</p> : null}
              {!reference.excerptMatches ? <p className="mt-1 text-amber-700 dark:text-amber-400">Source text changed since this draft was generated.</p> : null}
              <p className="mt-1 whitespace-pre-wrap">{reference.excerpt}</p>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

function dispositionLabel(disposition: AnswerModel["aiDisposition"]): string {
  if (disposition === "answered") return "AI answer";
  if (disposition === "needs_review") return "Needs human review";
  return "Insufficient evidence";
}
