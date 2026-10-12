"use client";

import { useState } from "react";

import { AnswerEditor } from "@/features/questionnaires/components/answer-editor";
import { StatusActions } from "@/features/questionnaires/components/status-actions";

/**
 * Per-question editor + review controls sharing ONE revision/status state.
 *
 * Autosave deliberately skips revalidation (a full table re-render per
 * keystroke save would destroy input focus), so the review buttons cannot
 * read the server-rendered revision alone — a just-created answer would leave
 * "Submit for review" stale-disabled until reload. This island owns the
 * client-side revision/status after each save; the parent remounts it via
 * key on every server refresh so props and state can never drift.
 */

export function QuestionWorkspace({
  orgSlug,
  questionnaireId,
  questionId,
  initialText,
  initialRevision,
  initialStatus,
}: {
  orgSlug: string;
  questionnaireId: string;
  questionId: string;
  initialText: string;
  initialRevision: number | null;
  initialStatus: string;
}) {
  const [revision, setRevision] = useState(initialRevision);
  const [status, setStatus] = useState(initialStatus);

  return (
    <div className="grid gap-3">
      <AnswerEditor
        orgSlug={orgSlug}
        questionId={questionId}
        initialText={initialText}
        initialRevision={initialRevision}
        onSaved={(savedRevision, created) => {
          setRevision(savedRevision);
          if (created) {
            setStatus("answered");
          }
        }}
      />
      <StatusActions
        orgSlug={orgSlug}
        questionnaireId={questionnaireId}
        questionId={questionId}
        status={status}
        revision={revision}
      />
    </div>
  );
}
