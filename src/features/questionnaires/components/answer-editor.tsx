"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { saveAnswerAction } from "@/features/questionnaires/actions";
import { questionnaireCopyFor } from "@/features/questionnaires/copy";
import { ANSWER_TEXT_MAX } from "@/config/questionnaires";

/**
 * Autosaving answer editor (plan §8: manual answers + autosave). Debounced
 * saves go through save_answer with the revision the client last saw — the
 * RPC raises ANSWER_CONFLICT when someone else saved first, which stops
 * autosave and asks for an explicit reload (never a silent overwrite, never
 * a lost edit). Empty drafts are not autosaved: the database rejects blank
 * answer text, so clearing the field simply pauses saving.
 */

const AUTOSAVE_DELAY_MS = 800;

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "conflict" }
  | { kind: "error"; message: string };

export function AnswerEditor({
  orgSlug,
  questionId,
  initialText,
  initialRevision,
  onSaved,
}: {
  orgSlug: string;
  questionId: string;
  /** Current saved text; "" when no answer row exists yet. */
  initialText: string;
  /** Revision the client saw; null = no answer row yet (genuine create). */
  initialRevision: number | null;
  /** Notifies the shared row state (see QuestionWorkspace) after each save. */
  onSaved?: (revision: number, created: boolean) => void;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [, setRevision] = useState(initialRevision);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  // The debounced save runs long after the keystroke that scheduled it, so it
  // must read its inputs through refs — state values inside the timer callback
  // are the stale closure of the scheduling render (the pre-keystroke text).
  const textRef = useRef(initialText);
  const revisionRef = useRef(initialRevision);
  const savedTextRef = useRef(initialText);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest-wins guard: a slow in-flight save must not clobber a newer local
  // edit's state when it resolves after the user kept typing.
  const requestSeqRef = useRef(0);

  function setRevisionBoth(next: number): void {
    revisionRef.current = next;
    setRevision(next);
  }

  // Adopt input typed BEFORE hydration: the browser preserves user-modified
  // form values through hydration, but React state does not know about them —
  // pull them in once on mount and save what we find.
  useEffect(() => {
    const element = areaRef.current;
    if (element !== null && element.value !== textRef.current) {
      textRef.current = element.value;
      setText(element.value);
      scheduleSave();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only adoption
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  function scheduleSave(): void {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      void save();
    }, AUTOSAVE_DELAY_MS);
  }

  async function save(): Promise<void> {
    const trimmed = textRef.current.trim();
    // Empty drafts and unchanged text are not saved (the DB rejects blanks).
    if (trimmed === "" || trimmed === savedTextRef.current) {
      return;
    }
    const seq = ++requestSeqRef.current;
    setSaveState({ kind: "saving" });
    const result = await saveAnswerAction(orgSlug, questionId, revisionRef.current, trimmed);
    if (seq !== requestSeqRef.current) {
      return; // a newer keystroke superseded this response's UI state
    }
    if (result.status === "saved") {
      savedTextRef.current = trimmed;
      const created = revisionRef.current === null;
      setRevisionBoth(result.revision);
      setSaveState({ kind: "saved" });
      onSaved?.(result.revision, created);
      return;
    }
    if (result.status === "conflict") {
      setSaveState({ kind: "conflict" });
      return;
    }
    setSaveState({ kind: "error", message: questionnaireCopyFor(result.code) });
  }

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>): void {
    const next = event.target.value;
    textRef.current = next;
    setText(next);
    if (saveState.kind === "conflict") {
      return; // textarea is disabled — an explicit reload is required
    }
    setSaveState({ kind: "idle" });
    scheduleSave();
  }

  const conflict = saveState.kind === "conflict";
  const nearLimit = text.length > ANSWER_TEXT_MAX - 200;

  return (
    <div className="grid gap-2">
      <label className="sr-only" htmlFor={`answer-${questionId}`}>
        Answer
      </label>
      <textarea
        id={`answer-${questionId}`}
        ref={areaRef}
        value={text}
        onChange={handleChange}
        onBlur={() => {
          void save();
        }}
        disabled={conflict}
        maxLength={ANSWER_TEXT_MAX}
        rows={4}
        className="border-input bg-transparent focus-visible:ring-ring min-h-20 w-full rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
        placeholder="Write the answer — it autosaves as you type."
      />
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <p aria-live="polite" className="text-muted-foreground">
          {saveState.kind === "saving" ? (
            <span className="flex items-center gap-1">
              <Loader2 aria-hidden="true" className="size-3 animate-spin" /> Saving…
            </span>
          ) : saveState.kind === "saved" ? (
            <span className="flex items-center gap-1">
              <Check aria-hidden="true" className="size-3" /> Saved
            </span>
          ) : (
            " "
          )}
        </p>
        {nearLimit ? (
          <p className="text-muted-foreground">
            {text.length}/{ANSWER_TEXT_MAX}
          </p>
        ) : null}
      </div>
      {conflict ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <TriangleAlert aria-hidden="true" className="text-destructive size-4" />
          <span>{questionnaireCopyFor("ANSWER_CONFLICT")}</span>
          <Button variant="outline" size="sm" onClick={() => router.refresh()}>
            Reload
          </Button>
        </div>
      ) : null}
      {saveState.kind === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {saveState.message}
        </p>
      ) : null}
    </div>
  );
}
