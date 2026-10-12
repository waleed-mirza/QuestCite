"use client";

import { useActionState } from "react";
import { Check, CheckSquare, ChevronDown, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  bulkAssignAction,
  bulkBlankByChoiceAction,
  bulkReviewAction,
  type FormActionState,
} from "@/features/questionnaires/actions";
import { BULK_FORM_ID } from "@/features/questionnaires/constants";

/**
 * Bulk operations toolbar for the question data table. The row checkboxes
 * are NOT rendered inside this form (HTML forbids nested forms, and the
 * expanded rows contain their own comment forms) — they join it remotely
 * via the standard `form` attribute (see QuestionTable in the detail page).
 * All-or-nothing is enforced by the RPCs — a batch with one unknown/foreign
 * id, or one answer that moved since the list was rendered, updates NOTHING
 * (migration 0018).
 *
 * Deliberate UI constraint: the chosen operation rides a `<select>` value,
 * never the clicked button's `name`/`value` — React 19's formAction path
 * does not deliver the submitter's name/value to the server action
 * (reproduced 2026-09-03; the original two-button blank toggle silently
 * broke on it). Selects ride plain form data, which is proven.
 *
 * Bulk review sits behind a disclosure with explicit copy: it acts only on
 * answers in the expected source state (submit: answered/drafted; approve,
 * request changes, reject: in_review) and the batch is rejected wholesale
 * otherwise — the "where safe" of plan §W6.
 */

const INITIAL: FormActionState = { status: "idle" };

export type BulkMember = { userId: string; label: string };

export function BulkBar({
  orgSlug,
  questionnaireId,
  members,
  children,
}: {
  orgSlug: string;
  questionnaireId: string;
  members: BulkMember[];
  children: React.ReactNode;
}) {
  const [assignState, assignFormAction, assignPending] = useActionState(
    bulkAssignAction.bind(null, orgSlug, questionnaireId),
    INITIAL,
  );
  const [blankState, blankFormAction, blankPending] = useActionState(
    bulkBlankByChoiceAction.bind(null, orgSlug, questionnaireId),
    INITIAL,
  );
  const [reviewState, reviewFormAction, reviewPending] = useActionState(
    bulkReviewAction.bind(null, orgSlug, questionnaireId),
    INITIAL,
  );
  const busy = assignPending || blankPending || reviewPending;
  const feedback = [assignState, blankState, reviewState].find((state) => state.status !== "idle");

  return (
    <div className="grid gap-3">
      <form id={BULK_FORM_ID} className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5">
          <label htmlFor="bulk-assignee" className="sr-only">
            Assign selected questions to
          </label>
          <select
            id="bulk-assignee"
            name="assigneeId"
            defaultValue=""
            className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" size="sm" formAction={assignFormAction} disabled={busy}>
          <UserPlus aria-hidden="true" />
          {assignPending ? "Assigning…" : "Assign selected"}
        </Button>

        <div className="grid gap-1.5">
          <label htmlFor="bulk-blank" className="sr-only">
            Blank-by-choice action
          </label>
          <select
            id="bulk-blank"
            name="blankValue"
            defaultValue="true"
            className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
          >
            <option value="true">Mark blank by choice</option>
            <option value="false">Clear blank marker</option>
          </select>
        </div>
        <Button type="submit" variant="outline" size="sm" formAction={blankFormAction} disabled={busy}>
          <CheckSquare aria-hidden="true" />
          Apply blank marker
        </Button>

        <details className="w-full">
          <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer items-center gap-1 text-sm">
            <ChevronDown aria-hidden="true" className="size-4" />
            Bulk review…
          </summary>
          <div className="border-border/60 mt-2 grid gap-2 rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">
              Applies to every selected answer in the expected state — submit works on answered or drafted answers;
              the other actions work on answers in review. If anything moved since you loaded this page, the whole
              batch is refused and nothing changes.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="grid gap-1.5">
                <label htmlFor="bulk-review-target" className="sr-only">
                  Bulk review action
                </label>
                <select
                  id="bulk-review-target"
                  name="reviewTarget"
                  defaultValue="in_review"
                  className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
                >
                  <option value="in_review">Submit for review</option>
                  <option value="approved">Approve</option>
                  <option value="changes_requested">Request changes</option>
                  <option value="rejected">Reject</option>
                </select>
              </div>
              <Button type="submit" variant="default" size="sm" formAction={reviewFormAction} disabled={busy}>
                <Check aria-hidden="true" />
                Apply to selected
              </Button>
              {reviewPending ? (
                <p className="text-muted-foreground self-center text-xs" aria-live="polite">
                  Applying…
                </p>
              ) : null}
            </div>
          </div>
        </details>

        {feedback?.status === "error" ? (
          <p role="alert" className="text-destructive w-full text-sm">
            {feedback.message}
          </p>
        ) : null}
        {feedback?.status === "success" ? (
          <p role="status" className="text-muted-foreground w-full text-sm">
            {feedback.message}
          </p>
        ) : null}
      </form>
      {children}
    </div>
  );
}
