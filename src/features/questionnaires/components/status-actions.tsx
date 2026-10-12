"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RotateCcw, Send, ThumbsDown, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { setAnswerStatusAction } from "@/features/questionnaires/actions";
import { questionnaireCopyFor } from "@/features/questionnaires/copy";

/**
 * Answer review controls — the UI mirror of the DB answer state machine
 * (migration 0010): answered → in_review → approved | changes_requested |
 * rejected, with resubmit paths. Only legal targets are ever offered; the
 * RPC + trigger re-decide server-side. A revision conflict (someone moved
 * first) auto-refreshes the row instead of failing silently.
 */

type TransitionState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "error"; message: string };

const TRANSITIONS: Record<string, Array<{ target: "in_review" | "approved" | "changes_requested" | "rejected"; label: string; icon: typeof Send }>> = {
  answered: [{ target: "in_review", label: "Submit for review", icon: Send }],
  // AI drafts stay visibly unapproved; a human may send one to review or
  // approve/reject it through the same revision-checked state machine.
  drafted: [
    { target: "in_review", label: "Submit draft for review", icon: Send },
    { target: "approved", label: "Approve draft", icon: Check },
    { target: "changes_requested", label: "Request changes", icon: Undo2 },
    { target: "rejected", label: "Reject draft", icon: ThumbsDown },
  ],
  in_review: [
    { target: "approved", label: "Approve", icon: Check },
    { target: "changes_requested", label: "Request changes", icon: Undo2 },
    { target: "rejected", label: "Reject", icon: ThumbsDown },
  ],
  changes_requested: [{ target: "in_review", label: "Resubmit", icon: RotateCcw }],
  rejected: [{ target: "in_review", label: "Resubmit", icon: RotateCcw }],
};

export function StatusActions({
  orgSlug,
  questionnaireId,
  questionId,
  status,
  revision,
}: {
  orgSlug: string;
  questionnaireId: string;
  questionId: string;
  /** Current answer status (the question's denormalized status). */
  status: string;
  revision: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<TransitionState>({ kind: "idle" });

  const options = TRANSITIONS[status] ?? [];

  async function handleTransition(target: (typeof options)[number]["target"]): Promise<void> {
    if (revision === null) {
      return; // no answer content yet — nothing to move
    }
    setState({ kind: "busy" });
    const result = await setAnswerStatusAction(orgSlug, questionnaireId, questionId, revision, target);
    if (result.status === "saved") {
      startTransition(() => {
        // The action revalidated the page — refresh pulls the new status,
        // badges, and the fresh revision into this row.
        router.refresh();
      });
      return;
    }
    if (result.status === "conflict") {
      startTransition(() => {
        router.refresh(); // show the state that actually won
      });
      return;
    }
    setState({ kind: "error", message: questionnaireCopyFor(result.code) });
  }

  if (options.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.target}
            variant={option.target === "approved" ? "default" : "outline"}
            size="sm"
            disabled={state.kind === "busy" || isPending || revision === null}
            onClick={() => {
              void handleTransition(option.target);
            }}
          >
            {state.kind === "busy" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <option.icon aria-hidden="true" />}
            {option.label}
          </Button>
        ))}
      </div>
      {state.kind === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
