"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Bot, CircleStop, Loader2, Play, RotateCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BULK_FORM_ID } from "@/features/questionnaires/constants";
import { questionnaireCopyFor } from "@/features/questionnaires/copy";
import type {
  AnswerAvailability,
  AnswerRunItemSummary,
  AnswerRunSnapshot,
  AnswerRunStatus,
} from "@/features/questionnaires/ai-types";

type ApiResult<T> = { ok: true; value: T } | { ok: false; code: string };
type ControlPhase = "idle" | "confirm" | "running" | "cancelling" | "error";
type DriveResult = ApiResult<AnswerRunSnapshot>;

export function AnswerRunControls({
  orgSlug,
  questionnaireId,
  initialRun,
  availability,
  questionnaireReady,
}: {
  orgSlug: string;
  questionnaireId: string;
  initialRun: AnswerRunSnapshot | null;
  availability: AnswerAvailability;
  questionnaireReady: boolean;
}) {
  const router = useRouter();
  const [run, setRun] = useState<AnswerRunSnapshot | null>(initialRun);
  const [phase, setPhase] = useState<ControlPhase>("idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[] | null>(null);
  const stopRequested = useRef(false);

  const active = run?.status === "pending" || run?.status === "running";
  const failedItems = run?.items.filter((item) => item.status === "failed") ?? [];
  const disabled = availability !== "ready" || !questionnaireReady || phase === "running" || phase === "cancelling";

  function prepareStart(): void {
    const ids = selectedQuestionIds();
    setSelection(ids.length === 0 ? null : ids);
    setErrorCode(null);
    setPhase("confirm");
  }

  async function startConfirmed(): Promise<void> {
    setPhase("running");
    setErrorCode(null);
    stopRequested.current = false;
    const started = await startRun(orgSlug, questionnaireId, selection);
    if (!started.ok) {
      setPhase("error");
      setErrorCode(started.code);
      return;
    }
    await continueRun(started.value);
  }

  async function continueRun(runId: string): Promise<void> {
    const driven = await driveRun({
      orgSlug,
      runId,
      onSnapshot: setRun,
      shouldStop: () => stopRequested.current,
    });
    if (stopRequested.current) {
      return;
    }
    if (!driven.ok) {
      setPhase("error");
      setErrorCode(driven.code);
      return;
    }
    setRun(driven.value);
    setPhase("idle");
    router.refresh();
  }

  async function resumeRun(): Promise<void> {
    if (run === null || !active) return;
    setPhase("running");
    setErrorCode(null);
    stopRequested.current = false;
    await continueRun(run.id);
  }

  async function cancelRun(): Promise<void> {
    if (run === null || !active) return;
    stopRequested.current = true;
    setPhase("cancelling");
    const result = await postJson(`/api/answer-runs/${run.id}/cancel`, { orgSlug });
    if (!result.ok) {
      stopRequested.current = false;
      setPhase("error");
      setErrorCode(result.code);
      return;
    }
    const next = snapshotFromResponse(result.value);
    if (!next.ok) {
      setPhase("error");
      setErrorCode(next.code);
      return;
    }
    setRun(next.value);
    setPhase("idle");
    router.refresh();
  }

  async function retryFailed(): Promise<void> {
    if (run === null || failedItems.length === 0) return;
    setPhase("running");
    setErrorCode(null);
    stopRequested.current = false;
    let current = run;
    for (const item of failedItems) {
      const result = await postJson(`/api/answer-runs/${run.id}/retry`, { orgSlug, itemId: item.id });
      if (!result.ok) {
        setPhase("error");
        setErrorCode(result.code);
        return;
      }
      const next = snapshotFromResponse(result.value);
      if (!next.ok) {
        setPhase("error");
        setErrorCode(next.code);
        return;
      }
      current = next.value;
      setRun(current);
    }
    await continueRun(current.id);
  }

  return (
    <div className="border-border/70 bg-muted/20 mt-4 grid gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Bot aria-hidden="true" className="size-4" />
            AI drafting
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-xs">
            Drafts use this workspace&apos;s approved evidence and always need human review before approval.
          </p>
        </div>
        <HeaderAction
          availability={availability}
          questionnaireReady={questionnaireReady}
          phase={phase}
          selection={selection}
          active={active === true}
          hasRun={run !== null}
          disabled={disabled}
          onConfirm={startConfirmed}
          onPrepare={prepareStart}
          onResume={resumeRun}
          onCancelConfirmation={() => setPhase("idle")}
        />
      </div>

      {phase === "running" || phase === "cancelling" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" aria-live="polite" className="text-sm">
            {processingLabel(phase, run)}
          </p>
          {active && phase === "running" ? (
            <Button size="sm" variant="outline" onClick={() => { void cancelRun(); }}>
              <CircleStop aria-hidden="true" /> Cancel run
            </Button>
          ) : null}
        </div>
      ) : null}

      {run !== null && phase !== "confirm" ? <RunSummary run={run} failedItems={failedItems} onRetry={() => { void retryFailed(); }} busy={phase === "running" || phase === "cancelling"} /> : null}

      {phase === "error" && errorCode !== null ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <TriangleAlert aria-hidden="true" className="text-destructive size-4" />
          <span>{questionnaireCopyFor(errorCode)}</span>
          {run !== null && active ? (
            <Button size="sm" variant="outline" onClick={() => { void resumeRun(); }}>
              <RotateCcw aria-hidden="true" /> Try again
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function GenerateDraftButton({
  orgSlug,
  questionnaireId,
  questionId,
  availability,
  questionnaireReady,
}: {
  orgSlug: string;
  questionnaireId: string;
  questionId: string;
  availability: AnswerAvailability;
  questionnaireReady: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function generate(): Promise<void> {
    setBusy(true);
    setErrorCode(null);
    const started = await startRun(orgSlug, questionnaireId, [questionId]);
    if (!started.ok) {
      setBusy(false);
      setErrorCode(started.code);
      return;
    }
    const driven = await driveRun({ orgSlug, runId: started.value, onSnapshot: () => undefined, shouldStop: () => false, batchSize: 1 });
    if (!driven.ok) {
      setBusy(false);
      setErrorCode(driven.code);
      return;
    }
    setBusy(false);
    router.refresh();
  }

  if (availability !== "ready" || !questionnaireReady) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => { void generate(); }}
      >
        {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Bot aria-hidden="true" />}
        {busy ? "Drafting…" : "Generate draft"}
      </Button>
      {errorCode !== null ? <span role="alert" className="text-destructive text-xs">{questionnaireCopyFor(errorCode)}</span> : null}
    </div>
  );
}

function selectedQuestionIds(): string[] {
  if (typeof document === "undefined") return [];
  return Array.from(document.querySelectorAll<HTMLInputElement>(`input[form="${BULK_FORM_ID}"][name="questionIds"]:checked`))
    .map((input) => input.value)
    .filter((value) => value !== "");
}

async function startRun(orgSlug: string, questionnaireId: string, questionIds: string[] | null): Promise<ApiResult<string>> {
  const payload: Record<string, unknown> = {
    orgSlug,
    idempotencyKey: crypto.randomUUID(),
  };
  if (questionIds !== null) {
    payload.questionIds = questionIds;
  }
  const result = await postJson(`/api/questionnaires/${questionnaireId}/runs`, payload);
  if (!result.ok) return result;
  if (!isRecord(result.value) || typeof result.value.runId !== "string") {
    return { ok: false, code: "RUN_RPC_FAILED" };
  }
  return { ok: true, value: result.value.runId };
}

async function nextRun(orgSlug: string, runId: string, batchSize: number): Promise<DriveResult> {
  const result = await postJson(`/api/answer-runs/${runId}/next`, { orgSlug, batchSize });
  if (!result.ok) return result;
  return snapshotFromResponse(result.value);
}

async function driveRun({
  orgSlug,
  runId,
  onSnapshot,
  shouldStop,
  batchSize = 3,
}: {
  orgSlug: string;
  runId: string;
  onSnapshot: (snapshot: AnswerRunSnapshot) => void;
  shouldStop: () => boolean;
  batchSize?: number;
}): Promise<DriveResult> {
  let latest: AnswerRunSnapshot | null = null;
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (shouldStop()) {
      return latest === null ? { ok: false, code: "RUN_RPC_FAILED" } : { ok: true, value: latest };
    }
    const result = await nextRun(orgSlug, runId, batchSize);
    if (!result.ok) return result;
    latest = result.value;
    onSnapshot(latest);
    if (latest.status !== "pending" && latest.status !== "running") {
      return { ok: true, value: latest };
    }
    if (latest.pending === 0 && latest.processing === 0) {
      return { ok: true, value: latest };
    }
    // Give another tab/worker a brief chance to finish an in-flight item
    // before asking the transactional claim RPC for the next batch.
    await wait(250);
  }
  return { ok: false, code: "RUN_RPC_FAILED" };
}

function snapshotFromResponse(value: unknown): ApiResult<AnswerRunSnapshot> {
  if (!isRecord(value) || !isAnswerRunSnapshot(value.run)) {
    return { ok: false, code: "RUN_RPC_FAILED" };
  }
  return { ok: true, value: value.run };
}

async function postJson(url: string, payload: Record<string, unknown>): Promise<ApiResult<unknown>> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, code: errorCodeFromResponse(value) };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, code: "RUN_RPC_FAILED" };
  }
}

function errorCodeFromResponse(value: unknown): string {
  return isRecord(value) && typeof value.code === "string" ? value.code : "RUN_RPC_FAILED";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAnswerRunSnapshot(value: unknown): value is AnswerRunSnapshot {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.questionnaireId === "string"
    && isRunStatus(value.status)
    && isNonNegativeInteger(value.total)
    && isNonNegativeInteger(value.pending)
    && isNonNegativeInteger(value.processing)
    && isNonNegativeInteger(value.completed)
    && isNonNegativeInteger(value.failed)
    && isNonNegativeInteger(value.skipped)
    && isNonNegativeInteger(value.inputTokens)
    && isNonNegativeInteger(value.outputTokens)
    && isNonNegativeInteger(value.estimatedCostMicroUsd)
    && (value.errorCode === null || typeof value.errorCode === "string")
    && Array.isArray(value.items)
    && value.items.every(isAnswerRunItem);
}

function isAnswerRunItem(value: unknown): value is AnswerRunItemSummary {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.questionId === "string"
    && isItemStatus(value.status)
    && isNonNegativeInteger(value.attempts)
    && (value.errorCode === null || typeof value.errorCode === "string")
    && (value.disposition === null || value.disposition === "answered" || value.disposition === "needs_review" || value.disposition === "insufficient_evidence");
}

function isRunStatus(value: unknown): value is AnswerRunStatus {
  return value === "pending" || value === "running" || value === "completed" || value === "failed" || value === "cancelled";
}

function isItemStatus(value: unknown): value is AnswerRunItemSummary["status"] {
  return value === "pending" || value === "processing" || value === "completed" || value === "failed" || value === "skipped";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function runProgressLabel(run: AnswerRunSnapshot): string {
  const remaining = run.pending + run.processing;
  return `${run.completed} of ${run.total} processed${remaining > 0 ? ` · ${remaining} remaining` : ""}`;
}

function processingLabel(phase: ControlPhase, run: AnswerRunSnapshot | null): string {
  if (phase === "cancelling") {
    return "Cancelling…";
  }
  if (run === null) {
    return "Starting…";
  }
  return runProgressLabel(run);
}

function HeaderAction(input: {
  availability: AnswerAvailability;
  questionnaireReady: boolean;
  phase: ControlPhase;
  selection: string[] | null;
  active: boolean;
  hasRun: boolean;
  disabled: boolean;
  onConfirm: () => Promise<void>;
  onPrepare: () => void;
  onResume: () => Promise<void>;
  onCancelConfirmation: () => void;
}): ReactNode {
  if (input.availability === "disabled") {
    return <p role="status" className="text-muted-foreground text-xs">AI drafting is disabled.</p>;
  }
  if (input.availability === "not_configured") {
    return <p role="status" className="text-muted-foreground text-xs">AI drafting is not configured on this deployment.</p>;
  }
  if (!input.questionnaireReady) {
    return <p role="status" className="text-muted-foreground text-xs">Finish importing the questionnaire first.</p>;
  }
  if (input.phase === "confirm") {
    const prompt = input.selection === null
      ? "Generate drafts for all eligible questions?"
      : `Generate ${input.selection.length} selected draft${input.selection.length === 1 ? "" : "s"}?`;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">{prompt}</span>
        <Button size="sm" onClick={() => { void input.onConfirm(); }}>
          <Bot aria-hidden="true" /> Generate drafts
        </Button>
        <Button size="sm" variant="outline" onClick={input.onCancelConfirmation}>
          Cancel
        </Button>
      </div>
    );
  }
  if (input.active && input.phase === "idle") {
    return (
      <Button size="sm" onClick={() => { void input.onResume(); }}>
        <Play aria-hidden="true" /> Resume drafting
      </Button>
    );
  }
  if (!input.hasRun || (!input.active && input.phase === "idle")) {
    return (
      <Button size="sm" disabled={input.disabled} onClick={input.onPrepare}>
        <Bot aria-hidden="true" /> Generate drafts
      </Button>
    );
  }
  return null;
}

function RunSummary({
  run,
  failedItems,
  onRetry,
  busy,
}: {
  run: AnswerRunSnapshot;
  failedItems: AnswerRunItemSummary[];
  onRetry: () => void;
  busy: boolean;
}) {
  const cost = (run.estimatedCostMicroUsd / 1_000_000).toFixed(4);
  const statusLabel = summaryStatusLabel(run, failedItems.length);
  return (
    <div className="grid gap-2 text-xs">
      <p role="status" aria-live="polite">
        {statusLabel}
      </p>
      <p className="text-muted-foreground">
        {run.completed} completed · {failedItems.length} failed · {run.skipped} skipped · estimated cost ${cost}
      </p>
      {failedItems.length > 0 && run.status === "completed" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Some items need another attempt.</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
            <RotateCcw aria-hidden="true" /> Retry failed
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function summaryStatusLabel(run: AnswerRunSnapshot, failedCount: number): string {
  if (run.status === "completed" && failedCount === 0) {
    return "Drafting complete — review each draft before approval.";
  }
  if (run.status === "cancelled") {
    return "Drafting cancelled. Completed items are still available for review.";
  }
  return runProgressLabel(run);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}
