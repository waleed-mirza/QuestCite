"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { addCommentAction, type FormActionState } from "@/features/questionnaires/actions";

/**
 * Per-question comment form (plan §8). Server-rendered <details> hosts this
 * island so the surrounding table stays server components; the form reports
 * validation/permission failures through useActionState.
 */

const INITIAL: FormActionState = { status: "idle" };

export function CommentForm({
  orgSlug,
  questionnaireId,
  questionId,
}: {
  orgSlug: string;
  questionnaireId: string;
  questionId: string;
}) {
  const [state, formAction, pending] = useActionState(
    addCommentAction.bind(null, orgSlug, questionnaireId, questionId),
    INITIAL,
  );

  return (
    <form action={formAction} className="grid gap-2">
      <div className="grid gap-1.5">
        <Label htmlFor={`comment-${questionId}`} className="sr-only">
          Add a comment
        </Label>
        <textarea
          id={`comment-${questionId}`}
          name="body"
          required
          maxLength={2000}
          rows={2}
          placeholder="Add a comment for your team…"
          className="border-input bg-transparent focus-visible:ring-ring min-h-16 w-full rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        />
      </div>
      {state.status === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p role="status" className="text-muted-foreground text-sm">
          {state.message}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Adding…" : "Comment"}
        </Button>
      </div>
    </form>
  );
}
