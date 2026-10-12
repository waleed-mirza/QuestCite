"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QUESTION_CATEGORY_MAX } from "@/config/questionnaires";
import {
  updateQuestionCategoryAction,
  type CategoryUpdateResult,
} from "@/features/questionnaires/actions";
import { questionnaireCopyFor } from "@/features/questionnaires/copy";
import { questionCategorySchema } from "@/lib/validation/questionnaire";

/**
 * Inline category editor for one question (plan §W4: the data table carries
 * category as an editable dimension, not just a filter — the
 * update_question_category RPC + its RLS matrix ship in migration 0010 /
 * rls.questionnaires.test.ts).
 *
 * Deliberately its own island OUTSIDE QuestionWorkspace: that one remounts on
 * every answer revision bump (its key carries the revision), which would wipe
 * in-progress category typing on each autosave. This island is keyed by the
 * category itself (parent), so it only remounts when the server value changes.
 */

type EditorState =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export function CategoryEditor({
  orgSlug,
  questionnaireId,
  questionId,
  initialCategory,
}: {
  orgSlug: string;
  questionnaireId: string;
  questionId: string;
  /** The category as last rendered by the server. */
  initialCategory: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialCategory);
  const [state, setState] = useState<EditorState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = questionCategorySchema.safeParse(value);
    if (!parsed.success) {
      setState({ kind: "error", message: `Categories must be 1–${QUESTION_CATEGORY_MAX} characters.` });
      return;
    }
    setState({ kind: "idle" });
    startTransition(async () => {
      const result: CategoryUpdateResult = await updateQuestionCategoryAction(
        orgSlug,
        questionnaireId,
        questionId,
        parsed.data,
      );
      if (result.status === "saved") {
        setState({ kind: "saved" });
        startTransition(() => {
          // The action revalidated the page — refresh pulls the new category
          // into the row cell and this island remounts on its new key.
          router.refresh();
        });
        return;
      }
      setState({ kind: "error", message: questionnaireCopyFor(result.code) });
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-1.5">
      <label className="text-muted-foreground text-xs font-medium uppercase tracking-wide" htmlFor={`category-${questionId}`}>
        Category
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={`category-${questionId}`}
          value={value}
          maxLength={QUESTION_CATEGORY_MAX}
          onChange={(event) => {
            setValue(event.target.value);
            if (state.kind !== "idle") {
              setState({ kind: "idle" });
            }
          }}
          className="h-8 w-44 text-sm"
        />
        <Button type="submit" variant="outline" size="sm" disabled={isPending || value.trim() === initialCategory}>
          {isPending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          Save
        </Button>
      </div>
      <p aria-live="polite" className="text-muted-foreground text-xs">
        {state.kind === "saved" ? (
          <span className="flex items-center gap-1">
            <Check aria-hidden="true" className="size-3" /> Saved
          </span>
        ) : (
          `1–${QUESTION_CATEGORY_MAX} characters`
        )}
      </p>
      {state.kind === "error" ? (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
