"use client";

import { useState } from "react";
import { History, Loader2 } from "lucide-react";

import { diffLines, diffStats } from "@/features/questionnaires/version-diff";

/**
 * Answer version history + compare view (plan §W6). Versions load lazily from
 * the read-only route when the disclosure opens; the compare view diffs two
 * selected versions with the pure line-diff. Content is the user's own
 * answer text (already org-scoped by RLS) — no ids or codes leak here.
 */

type VersionRow = {
  id: string;
  versionNumber: number;
  text: string;
  creatorType: string;
  revision: number;
  createdAt: string;
  authorName: string | null;
};

export function AnswerVersionHistory({ questionId }: { questionId: string }) {
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "loaded"; versions: VersionRow[] } | { kind: "error"; code: string }
  >({ kind: "idle" });
  // Defaults to comparing the two most recent versions once loaded.
  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>("");

  async function handleOpen(): Promise<void> {
    if (state.kind === "loaded" || state.kind === "loading") {
      return;
    }
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/questions/${questionId}/versions`);
      const payload: unknown = await response.json();
      if (!response.ok || typeof payload !== "object" || payload === null || !("versions" in payload)) {
        setState({ kind: "error", code: "HISTORY_FAILED" });
        return;
      }
      const versions = (payload as { versions: VersionRow[] }).versions;
      setState({ kind: "loaded", versions });
      const last = versions.at(-1);
      const previous = versions.at(-2);
      if (last !== undefined) {
        setToId(last.id);
        setFromId(previous?.id ?? last.id);
      }
    } catch {
      setState({ kind: "error", code: "HISTORY_FAILED" });
    }
  }

  const versions = state.kind === "loaded" ? state.versions : [];
  const from = versions.find((version) => version.id === fromId);
  const to = versions.find((version) => version.id === toId);
  const ops = from !== undefined && to !== undefined ? diffLines(from.text, to.text) : [];
  const stats = diffStats(ops);

  return (
    <details
      onToggle={(event) => {
        if ((event.target as HTMLDetailsElement).open) {
          void handleOpen();
        }
      }}
    >
      <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer items-center gap-1 text-xs">
        <History aria-hidden="true" className="size-4" />
        Version history
      </summary>
      <div className="mt-2 grid gap-3">
        {state.kind === "loading" || state.kind === "idle" ? (
          <p className="text-muted-foreground flex items-center gap-2 text-xs" aria-live="polite">
            <Loader2 aria-hidden="true" className="size-3 animate-spin" /> Loading history…
          </p>
        ) : null}
        {state.kind === "error" ? (
          <p role="alert" className="text-destructive text-xs">
            {state.code === "FORBIDDEN"
              ? "You don't have permission to view this history."
              : "The version history could not be loaded."}
          </p>
        ) : null}
        {state.kind === "loaded" && versions.length === 0 ? (
          <p className="text-muted-foreground text-xs">No saved versions yet — every saved text change is kept here.</p>
        ) : null}
        {state.kind === "loaded" && versions.length > 0 ? (
          <>
            <div className="flex flex-wrap items-end gap-2 text-xs">
              <div className="grid gap-1">
                <label htmlFor={`version-from-${questionId}`}>Compare</label>
                <select
                  id={`version-from-${questionId}`}
                  value={fromId}
                  onChange={(event) => {
                    setFromId(event.target.value);
                  }}
                  className="border-input h-8 rounded-lg border bg-transparent px-2 text-xs"
                >
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.versionNumber}
                    </option>
                  ))}
                </select>
              </div>
              <span className="text-muted-foreground pb-2">→</span>
              <div className="grid gap-1">
                <label htmlFor={`version-to-${questionId}`}>with</label>
                <select
                  id={`version-to-${questionId}`}
                  value={toId}
                  onChange={(event) => {
                    setToId(event.target.value);
                  }}
                  className="border-input h-8 rounded-lg border bg-transparent px-2 text-xs"
                >
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.versionNumber}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-muted-foreground pb-2" aria-live="polite">
                {stats.added + stats.removed === 0
                  ? "Identical"
                  : `+${stats.added} / −${stats.removed} lines`}
              </p>
            </div>

            {from !== undefined && to !== undefined && stats.added + stats.removed > 0 ? (
              <div className="border-border/60 overflow-x-auto rounded-lg border text-xs">
                <ul className="grid">
                  {ops.map((op, index) => (
                    <li
                      key={index}
                      className={
                        op.type === "added"
                          ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-l-2 border-emerald-600 px-2 py-0.5 whitespace-pre-wrap"
                          : op.type === "removed"
                            ? "bg-red-500/10 text-red-800 dark:text-red-300 border-l-2 border-red-600 px-2 py-0.5 whitespace-pre-wrap line-through decoration-red-400/60"
                            : "text-muted-foreground border-border/40 border-l-2 px-2 py-0.5 whitespace-pre-wrap"
                      }
                    >
                      <span aria-hidden="true" className="mr-1 select-none">
                        {op.type === "added" ? "+" : op.type === "removed" ? "−" : " "}
                      </span>
                      <span className="sr-only">
                        {op.type === "added" ? "Added: " : op.type === "removed" ? "Removed: " : ""}
                      </span>
                      {op.text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <ul className="grid gap-1">
              {versions
                .slice()
                .reverse()
                .map((version) => (
                  <li key={version.id} className="text-muted-foreground text-xs">
                    v{version.versionNumber} · {version.creatorType === "ai" ? "AI draft" : "Manual"} ·{" "}
                    {version.authorName ?? "Former member"} · {new Date(version.createdAt).toLocaleString()}
                  </li>
                ))}
            </ul>
          </>
        ) : null}
      </div>
    </details>
  );
}
