import type { Database } from "@/types/database.types";

/**
 * Export rules (plan §9 Export + §W6, D012/D021/D023): what may be written to
 * a final export, and what the exported file is called.
 *
 * A question is EXPORT-ELIGIBLE when its state is a deliberate decision —
 * answered or any review state, an AI disposition, or a conscious
 * blank-by-choice. Unreviewed AI drafts, in-flight runs, and untouched
 * questions are NOT exportable, so generated-but-unaccepted text can never
 * reach a customer file. Pure logic only: the DB's completed gate (migration
 * 0018) is the authoritative backstop, this module gives the UI instant,
 * testable feedback.
 */

type AnswerStatus = Database["public"]["Enums"]["answer_status"];

const EXPORT_ELIGIBLE_STATUSES: readonly AnswerStatus[] = [
  "answered",
  "insufficient_evidence",
  "in_review",
  "changes_requested",
  "rejected",
  "approved",
];

/** The two question columns the rules need (the read-model wire shape). */
export type ExportEligibilityRow = {
  status: AnswerStatus;
  blank_by_choice: boolean;
};

export function isQuestionExportEligible(row: ExportEligibilityRow): boolean {
  return row.blank_by_choice || EXPORT_ELIGIBLE_STATUSES.includes(row.status);
}

export type ExportReadiness = {
  total: number;
  eligible: number;
  /** Questions that still block the export (empty/generating/drafted). */
  unresolved: number;
  approved: number;
  /** Conscious blanks + AI abstentions — exported as empty cells. */
  emptyCellCount: number;
};

export function summarizeExportReadiness(rows: ExportEligibilityRow[]): ExportReadiness {
  let eligible = 0;
  let approved = 0;
  let emptyCellCount = 0;
  for (const row of rows) {
    if (isQuestionExportEligible(row)) {
      eligible += 1;
    }
    if (row.status === "approved") {
      approved += 1;
    }
    // Conscious blanks and abstention markers export as deliberately empty
    // cells (D021); answered text is written as-is.
    if (row.blank_by_choice || row.status === "insufficient_evidence") {
      emptyCellCount += 1;
    }
  }
  return {
    total: rows.length,
    eligible,
    unresolved: rows.length - eligible,
    approved,
    emptyCellCount,
  };
}

/**
 * The cell text an eligible question contributes to the export: its current
 * answer text, or an empty cell for a conscious blank / abstention. A
 * blank-by-choice marker wins over any leftover text — it is the later,
 * deliberate declaration.
 */
export function exportTextFor(row: ExportEligibilityRow & { current_text: string }): string {
  if (row.blank_by_choice || row.status === "insufficient_evidence") {
    return "";
  }
  return row.current_text;
}

/** One row of the export history list (plan §W6) — pure UI shape. */
export type ExportHistoryRow = {
  id: string;
  filename: string;
  format: string;
  byteSize: number;
  checksum: string;
  questionCount: number;
  approvedCount: number;
  blankCount: number;
  exportedBy: string | null;
  exporterName: string | null;
  createdAt: string;
};

const CONTROL_CHAR = /[\x00-\x1f\x7f]/;

/**
 * Server-side export filename (plan §W6 "safe filename"): derived from the
 * ORIGINAL upload's name, never user input on the export request. The result
 * is extension-correct, free of separators/control characters, and length-
 * capped; the record RPC's CHECK is the backstop.
 */
export function buildExportFilename(originalFilename: string, format: "xlsx" | "csv", now: Date): string {
  const basename = (originalFilename.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "");
  let stem = "";
  for (const char of basename.normalize("NFKD")) {
    if (!CONTROL_CHAR.test(char) && char !== "/" && char !== "\\") {
      stem += char;
    }
  }
  stem = stem.replace(/\s+/g, " ").trim().replace(/^[. ]+/, "").slice(0, 80);
  if (stem === "") {
    stem = "questionnaire";
  }
  const stamp = [
    now.getUTCFullYear().toString().padStart(4, "0"),
    (now.getUTCMonth() + 1).toString().padStart(2, "0"),
    now.getUTCDate().toString().padStart(2, "0"),
  ].join("");
  return `${stem}-answers-${stamp}.${format}`;
}
