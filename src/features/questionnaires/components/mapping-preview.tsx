"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MAX_QUESTIONS_PER_IMPORT } from "@/config/questionnaires";
import { confirmMappingAction } from "@/features/questionnaires/actions";
import { questionnaireCopyFor } from "@/features/questionnaires/copy";
import { detectColumns } from "@/lib/files/questionnaire/detect";
import type { WorkbookInspection, WorkbookWarningCode } from "@/lib/files/questionnaire/types";
import { numberToColumnName } from "@/lib/files/questionnaire/cellref";

/**
 * Mapping preview (plan §9 step 4): shows the inspected sheet with DETECTED
 * column roles as a PREFILL only — every value is an editable select and the
 * import happens solely when the user presses "Confirm mapping & import".
 * Nothing is auto-applied: detection runs client-side per sheet (pure
 * function over the matrix), low-confidence roles preselect nothing, and the
 * live import count under the button is exactly what confirm will import.
 */

const WARNING_COPY: Record<WorkbookWarningCode, string> = {
  MERGED_CELLS: "This sheet contains merged cells — check the preview carefully.",
  FORMULAS_PRESENT: "Cells with formulas were read as their displayed values.",
  IMAGES_PRESENT: "Embedded images are ignored.",
  MULTIPLE_SHEETS: "This workbook has multiple sheets — pick the one with the questions.",
  TRUNCATED_ROWS: "Only the first 2000 rows were read; the rest are not importable here.",
  TRUNCATED_COLUMNS: "Only the first 64 columns were read.",
  LARGE_CELLS: "Some cells were longer than 4000 characters and were cut off.",
};

const PREVIEW_ROW_LIMIT = 12;
const HEADER_ROW_CHOICES = 20;

type MappingState =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "error"; message: string };

export function MappingPreview({
  orgSlug,
  questionnaireId,
  inspection,
}: {
  orgSlug: string;
  questionnaireId: string;
  inspection: WorkbookInspection;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<MappingState>({ kind: "idle" });

  const sheetsWithContent = useMemo(
    () => inspection.sheets.filter((sheet) => sheet.rowCount > 0),
    [inspection.sheets],
  );
  const [sheetName, setSheetName] = useState(() => sheetsWithContent[0]?.name ?? inspection.sheets[0]?.name ?? "");
  const sheet = sheetsWithContent.find((candidate) => candidate.name === sheetName) ?? sheetsWithContent[0];

  // Detection is a SUGGESTION: it preselects the selects below and nothing else.
  const initialDetection = useMemo(
    () => (sheet === undefined ? null : detectColumns(sheet)),
    [sheet],
  );
  const [headerRowIndex, setHeaderRowIndex] = useState(() => initialDetection?.headerRowIndex ?? -1);
  const [questionColumn, setQuestionColumn] = useState<number | null>(() => initialDetection?.questionColumn ?? null);
  const [answerColumn, setAnswerColumn] = useState<number | null>(() => initialDetection?.answerColumn ?? null);
  const [notesColumn, setNotesColumn] = useState<number | null>(() => initialDetection?.notesColumn ?? null);

  function selectSheet(name: string): void {
    setSheetName(name);
    const nextSheet = sheetsWithContent.find((candidate) => candidate.name === name);
    if (nextSheet === undefined) {
      return;
    }
    // Re-suggest per sheet — again, prefill only.
    const detection = detectColumns(nextSheet);
    setHeaderRowIndex(detection.headerRowIndex);
    setQuestionColumn(detection.questionColumn);
    setAnswerColumn(detection.answerColumn);
    setNotesColumn(detection.notesColumn);
  }

  const importableCount = useMemo(() => {
    if (sheet === undefined || questionColumn === null || headerRowIndex >= sheet.rowCount) {
      return 0;
    }
    let count = 0;
    for (let row = headerRowIndex + 1; row < sheet.rowCount; row += 1) {
      if ((sheet.matrix[row]?.[questionColumn] ?? "").trim() !== "") {
        count += 1;
      }
    }
    return count;
  }, [sheet, questionColumn, headerRowIndex]);

  const overLimit = importableCount > MAX_QUESTIONS_PER_IMPORT;

  const columnLabel = (column: number): string => {
    const header = headerRowIndex >= 0 ? (sheet?.matrix[headerRowIndex]?.[column] ?? "").trim() : "";
    const letter = numberToColumnName(column + 1);
    return header !== "" ? `${letter} — ${header.slice(0, 40)}` : `Column ${letter}`;
  };

  async function handleConfirm(): Promise<void> {
    if (questionColumn === null) {
      setState({ kind: "error", message: "Choose the column that holds the questions." });
      return;
    }
    setState({ kind: "confirming" });
    const result = await confirmMappingAction(orgSlug, {
      questionnaireId,
      sheetName: sheetName || "CSV",
      headerRowIndex,
      questionColumn,
      answerColumn,
      notesColumn,
    });
    if (result.status === "success") {
      startTransition(() => {
        router.push(`/app/${orgSlug}/questionnaires/${questionnaireId}`);
      });
      return;
    }
    setState({ kind: "error", message: questionnaireCopyFor(result.code) });
  }

  if (sheet === undefined) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {questionnaireCopyFor("WORKBOOK_EMPTY")}
      </p>
    );
  }

  const previewRows = sheet.matrix.slice(0, PREVIEW_ROW_LIMIT);
  const headerChoices = Array.from({ length: Math.min(HEADER_ROW_CHOICES, sheet.rowCount) }, (_, index) => index);
  const columns = Array.from({ length: sheet.columnCount }, (_, index) => index);
  const highlighted = new Set([questionColumn, answerColumn, notesColumn].filter((column): column is number => column !== null));

  return (
    <div className="grid gap-6">
      {inspection.warnings.length > 0 ? (
        <ul className="text-muted-foreground grid gap-1 text-sm" aria-label="Workbook warnings">
          {[...new Set(inspection.warnings.map((warning) => warning.code))].map((code) => (
            <li key={code} className="flex items-start gap-2">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {WARNING_COPY[code]}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="map-sheet">Sheet</Label>
          <select
            id="map-sheet"
            value={sheetName}
            onChange={(event) => selectSheet(event.target.value)}
            className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
          >
            {sheetsWithContent.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="map-header">Header row</Label>
          <select
            id="map-header"
            value={String(headerRowIndex)}
            onChange={(event) => setHeaderRowIndex(Number.parseInt(event.target.value, 10))}
            className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
          >
            <option value="-1">No header row</option>
            {headerChoices.map((index) => (
              <option key={index} value={String(index)}>
                Row {index + 1}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="map-question">Questions column (required)</Label>
          <select
            id="map-question"
            value={questionColumn === null ? "" : String(questionColumn)}
            onChange={(event) => setQuestionColumn(event.target.value === "" ? null : Number.parseInt(event.target.value, 10))}
            className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
            aria-required="true"
          >
            <option value="">Choose a column…</option>
            {columns.map((column) => (
              <option key={column} value={String(column)}>
                {columnLabel(column)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="map-answer">Answers column</Label>
          <select
            id="map-answer"
            value={answerColumn === null ? "" : String(answerColumn)}
            onChange={(event) => setAnswerColumn(event.target.value === "" ? null : Number.parseInt(event.target.value, 10))}
            className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
          >
            <option value="">None</option>
            {columns.map((column) => (
              <option key={column} value={String(column)}>
                {columnLabel(column)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="map-notes">Notes column</Label>
          <select
            id="map-notes"
            value={notesColumn === null ? "" : String(notesColumn)}
            onChange={(event) => setNotesColumn(event.target.value === "" ? null : Number.parseInt(event.target.value, 10))}
            className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
          >
            <option value="">None</option>
            {columns.map((column) => (
              <option key={column} value={String(column)}>
                {columnLabel(column)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Preview of the first {PREVIEW_ROW_LIMIT} rows; mapped columns are highlighted
          </caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className={`border-b px-2 py-1.5 text-left font-medium ${highlighted.has(column) ? "bg-primary/10" : ""}`}
                >
                  {columnLabel(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column) => (
                  <td
                    key={column}
                    className={`max-w-64 truncate border-b px-2 py-1.5 ${highlighted.has(column) ? "bg-primary/5" : ""}`}
                  >
                    {row[column] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-xs">
        Showing the first {Math.min(PREVIEW_ROW_LIMIT, sheet.rowCount)} of {sheet.rowCount} rows.
      </p>

      {state.kind === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleConfirm} disabled={questionColumn === null || overLimit || importableCount === 0 || state.kind === "confirming" || isPending}>
          <CheckCircle2 aria-hidden="true" />
          {state.kind === "confirming" || isPending ? "Importing…" : "Confirm mapping & import"}
        </Button>
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {questionColumn === null
            ? "Choose the questions column to continue — nothing has been imported yet."
            : overLimit
              ? `${importableCount} questions found — over the 1000 limit. Split the file or narrow the mapping.`
              : `Ready to import ${importableCount} question${importableCount === 1 ? "" : "s"} from “${sheetName}”.`}
        </p>
      </div>
    </div>
  );
}
