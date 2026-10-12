"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, PackageCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { exportQuestionnaireAction } from "@/features/questionnaires/export-actions";
import { questionnaireCopyFor } from "@/features/questionnaires/copy";
import type { ExportHistoryRow, ExportReadiness } from "@/features/questionnaires/export-rules";

/**
 * Export panel (plan §W6): readiness copy, the export control (opt-in summary
 * sheet), and the export history with short-lived downloads. Blocked states
 * are rendered, not assumed — the service re-decides everything server-side.
 *
 * On success the browser navigates to the download route (a plain GET, which
 * 302s to a 60-second signed URL) and refreshes so the new history row shows.
 */

type ExportPanelState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "success"; exportId: string; filename: string }
  | { kind: "error"; code: string };

export function ExportPanel({
  orgSlug,
  questionnaireId,
  format,
  questionnaireStatus,
  readiness,
  history,
  canExport,
}: {
  orgSlug: string;
  questionnaireId: string;
  format: "xlsx" | "csv";
  questionnaireStatus: string;
  readiness: ExportReadiness;
  history: ExportHistoryRow[];
  canExport: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [state, setState] = useState<ExportPanelState>({ kind: "idle" });
  const downloadFiredRef = useRef(false);

  const exportable = questionnaireStatus === "completed" || questionnaireStatus === "exported";
  const blocked = !exportable || readiness.unresolved > 0 || readiness.total === 0;
  const busy = state.kind === "busy";

  useEffect(() => {
    if (state.kind !== "success" || downloadFiredRef.current) {
      return;
    }
    downloadFiredRef.current = true;
    // Plain navigation via a transient anchor (NOT router.push): the route
    // responds with a 302 to a signed URL carrying an attachment disposition,
    // so the browser downloads the file and the page stays exactly where it
    // is — a client-side route transition would try to render the API route.
    const anchor = document.createElement("a");
    anchor.href = `/api/questionnaires/${questionnaireId}/exports/${state.exportId}/download`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    startTransition(() => {
      router.refresh(); // history row + exported badge
    });
  }, [state, questionnaireId, router, startTransition]);

  async function handleSubmit(formData: FormData): Promise<void> {
    setState({ kind: "busy" });
    const result = await exportQuestionnaireAction(orgSlug, questionnaireId, null, formData);
    if (result.status === "success") {
      setState({ kind: "success", exportId: result.exportId, filename: result.filename });
      return;
    }
    downloadFiredRef.current = false;
    setState({ kind: "error", code: result.code });
  }

  return (
    <Card>
      <CardContent className="grid gap-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Export</h2>
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {readiness.total === 0
              ? "No questions to export."
              : readiness.unresolved > 0
                ? `${readiness.unresolved} of ${readiness.total} questions still need a decision.`
                : `${readiness.eligible} of ${readiness.total} questions ready · ${readiness.approved} approved · ${readiness.emptyCellCount} deliberate blanks`}
          </p>
        </div>

        {canExport ? (
          <form
            action={(formData) => {
              void handleSubmit(formData);
            }}
            className="flex flex-wrap items-center gap-3"
          >
            <Button type="submit" disabled={blocked || busy}>
              {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <PackageCheck aria-hidden="true" />}
              {history.length > 0 ? "Export again" : "Export answers"}
            </Button>
            {format === "xlsx" ? (
              <span className="flex items-center gap-2 text-sm">
                <input type="checkbox" id="include-summary" name="includeSummary" className="size-4" />
                <label htmlFor="include-summary">Attach a summary sheet</label>
              </span>
            ) : null}
          </form>
        ) : (
          <p className="text-muted-foreground text-sm">
            Owners, admins, and reviewers can export this questionnaire.
          </p>
        )}
        {!exportable ? (
          <p className="text-muted-foreground text-xs">
            Finish the review (mark every question resolved, then complete the questionnaire) to unlock the export.
          </p>
        ) : null}
        {readiness.unresolved > 0 && exportable ? (
          <p className="text-muted-foreground text-xs">
            Unreviewed AI drafts and unanswered questions are never exported. Resolve them, or mark them as
            consciously blank.
          </p>
        ) : null}
        {state.kind === "error" ? (
          <p role="alert" className="text-destructive text-sm">
            {questionnaireCopyFor(state.code)}
          </p>
        ) : null}
        {state.kind === "success" ? (
          <p className="text-sm" aria-live="polite">
            Export created — your download should have started ({state.filename}).
          </p>
        ) : null}

        <ExportHistory history={history} questionnaireId={questionnaireId} />
      </CardContent>
    </Card>
  );
}

function ExportHistory({ history, questionnaireId }: { history: ExportHistoryRow[]; questionnaireId: string }) {
  if (history.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No exports yet. Every export is listed here with its checksum.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Export history with checksums and downloads</caption>
        <thead>
          <tr className="border-b bg-muted/40 text-left">
            <th scope="col" className="px-3 py-2 font-medium">File</th>
            <th scope="col" className="px-3 py-2 font-medium">Exported</th>
            <th scope="col" className="px-3 py-2 font-medium">Checksum (SHA-256)</th>
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">Download</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {history.map((row) => (
            <tr key={row.id} className="border-b">
              <td className="px-3 py-2">
                <p className="max-w-xs truncate font-medium" title={row.filename}>{row.filename}</p>
                <p className="text-muted-foreground text-xs">
                  {row.questionCount} questions · {row.approvedCount} approved · {row.blankCount} blanks ·{" "}
                  {(row.byteSize / 1024).toFixed(0)} KB
                  {row.exporterName !== null ? ` · by ${row.exporterName}` : ""}
                </p>
              </td>
              <td className="text-muted-foreground px-3 py-2 text-xs">
                {new Date(row.createdAt).toLocaleString()}
              </td>
              <td className="text-muted-foreground px-3 py-2 font-mono text-xs" title={row.checksum}>
                {row.checksum.slice(0, 12)}…
              </td>
              <td className="px-3 py-2">
                <a
                  href={`/api/questionnaires/${questionnaireId}/exports/${row.id}/download`}
                  className="hover:text-foreground text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
                >
                  <Download aria-hidden="true" className="size-4" />
                  <span className="sr-only">Download {row.filename}</span>
                  <span aria-hidden="true">Download</span>
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
