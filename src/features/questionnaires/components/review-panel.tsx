import { CheckCircle2, Send, Undo2, UserCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  setQuestionnaireReviewerAction,
  setQuestionnaireStatusAction,
} from "@/features/questionnaires/actions";
import type { BulkMember } from "@/features/questionnaires/components/bulk-bar";

/**
 * Review panel (plan §W6): questionnaire lifecycle transitions (PRD §7.1,
 * migration 0018) and reviewer assignment. Server-rendered forms — the RPCs
 * re-decide every transition; invalid moves simply do nothing and the page
 * re-renders the state that actually holds.
 *
 * The "complete" transition is offered only when every question is
 * export-eligible (D012/D021/D023) — the same readiness the export panel
 * shows — so the button never promises something the DB will refuse.
 */

export function ReviewPanel({
  orgSlug,
  questionnaireId,
  status,
  members,
  assignedReviewerId,
  canReview,
  allResolved,
}: {
  orgSlug: string;
  questionnaireId: string;
  status: string;
  members: BulkMember[];
  assignedReviewerId: string | null;
  canReview: boolean;
  allResolved: boolean;
}) {
  if (!canReview) {
    return null;
  }

  const lifecycleActions = lifecycleFor(status, allResolved);

  return (
    <Card>
      <CardContent className="grid gap-4 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Review</h2>

        {lifecycleActions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {lifecycleActions.map((action) => (
              <form key={action.target} action={setQuestionnaireStatusAction.bind(null, orgSlug, questionnaireId)}>
                <input type="hidden" name="targetStatus" value={action.target} />
                <Button type="submit" variant={action.variant} size="sm" disabled={!action.enabled}>
                  {action.target === "in_review" && status === "active" ? (
                    <Send aria-hidden="true" />
                  ) : action.target === "completed" ? (
                    <CheckCircle2 aria-hidden="true" />
                  ) : (
                    <Undo2 aria-hidden="true" />
                  )}
                  {action.label}
                </Button>
              </form>
            ))}
            {status === "in_review" && !allResolved ? (
              <p className="text-muted-foreground text-xs">
                Completing needs every question resolved — answered, reviewed, or consciously blank.
              </p>
            ) : null}
          </div>
        ) : null}
        {status === "exported" ? (
          <p className="text-muted-foreground text-xs">
            Exported questionnaires are frozen. Copy the workbook and import it again to start a new cycle.
          </p>
        ) : null}

        <form action={setQuestionnaireReviewerAction.bind(null, orgSlug, questionnaireId)} className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <label htmlFor="questionnaire-reviewer" className="text-xs font-medium">
              Assigned reviewer
            </label>
            <select
              id="questionnaire-reviewer"
              name="reviewerId"
              defaultValue={assignedReviewerId ?? ""}
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
          <Button type="submit" variant="outline" size="sm">
            <UserCheck aria-hidden="true" />
            Save reviewer
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

type LifecycleAction = {
  target: "in_review" | "active" | "completed";
  label: string;
  variant: "default" | "outline";
  enabled: boolean;
};

function lifecycleFor(status: string, allResolved: boolean): LifecycleAction[] {
  switch (status) {
    case "active":
      // Questionnaire-level wording — deliberately distinct from the
      // per-answer "Submit for review" row action.
      return [{ target: "in_review", label: "Start review", variant: "default", enabled: true }];
    case "in_review":
      return [
        { target: "active", label: "Back to drafting", variant: "outline", enabled: true },
        { target: "completed", label: "Complete review", variant: "default", enabled: allResolved },
      ];
    case "completed":
      return [{ target: "in_review", label: "Reopen review", variant: "outline", enabled: true }];
    default:
      // importing/mapping have their own surfaces; exported is frozen; archived
      // is terminal.
      return [];
  }
}
