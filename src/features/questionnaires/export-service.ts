import "server-only";

import { createHash } from "node:crypto";

import type { Database } from "@/types/database.types";

import {
  verifyOriginalCells,
  writeAnswersToWorkbook,
  type ExportAnswerLocation,
  type ExportCellExpectation,
  type ExportSummaryRow,
} from "@/lib/files/questionnaire/export";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  buildExportFilename,
  exportTextFor,
  summarizeExportReadiness,
} from "@/features/questionnaires/export-rules";

/**
 * Final export service (plan §9 Export + §W6): loads the UNTOUCHED original
 * from storage, verifies every mapped question cell still matches the import,
 * writes ONLY mapped answer cells through the round-trip-safe writer, reopens
 * and verifies the result, then stores the new bytes as a new object and
 * records the export (history + checksum + status flip + audit live in the
 * record_questionnaire_export RPC, migration 0018).
 *
 * The source file is never modified; every export is a new version. The
 * database gate (completed/exported + record RPC) is the authoritative
 * backstop for state and tenancy — this module's checks exist for clear,
 * immediate error copy.
 */

export type ExportServiceOutcome =
  | { status: "success"; exportId: string; filename: string; checksum: string; written: number }
  | { status: "error"; code: string };

export type ExportServiceInput = {
  organizationId: string;
  questionnaireId: string;
  /** Plan §9: the generated summary sheet is attached only when enabled. */
  includeSummary: boolean;
};

type AnswerStatus = Database["public"]["Enums"]["answer_status"];

type QuestionExportRow = {
  id: string;
  position: number;
  sheet_name: string;
  row_number: number;
  question_cell: string;
  answer_cell: string | null;
  question_original: string;
  category: string;
  status: AnswerStatus;
  blank_by_choice: boolean;
  answers: {
    current_text: string;
    status: AnswerStatus;
  } | null;
};

export async function runQuestionnaireExport(input: ExportServiceInput): Promise<ExportServiceOutcome> {
  const supabase = await createSupabaseServerClient();

  const { data: questionnaire, error: qnError } = await supabase
    .from("questionnaires")
    .select("id, status")
    .eq("id", input.questionnaireId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (qnError !== null || questionnaire === null) {
    return { status: "error", code: "QUESTIONNAIRE_NOT_FOUND" };
  }
  // Exports happen from a completed review; re-export stays available from
  // exported. The record RPC re-checks this — this is the early, clear copy.
  if (questionnaire.status !== "completed" && questionnaire.status !== "exported") {
    return { status: "error", code: "QUESTIONNAIRE_STATE_INVALID" };
  }

  const { data: file } = await supabase
    .from("questionnaire_files")
    .select("storage_path, format, mime_type, metadata")
    .eq("questionnaire_id", input.questionnaireId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (file === null) {
    return { status: "error", code: "QUESTIONNAIRE_NOT_FOUND" };
  }
  const format = file.format === "csv" ? "csv" : "xlsx";

  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select(
      "id, position, sheet_name, row_number, question_cell, answer_cell, question_original, category, status, blank_by_choice, answers(current_text, status)",
    )
    .eq("organization_id", input.organizationId)
    .eq("questionnaire_id", input.questionnaireId)
    .order("position", { ascending: true })
    .limit(2000);
  if (questionsError !== null || questions === null) {
    logger.warn("export question fetch failed", { code: "QUERY_FAILED" });
    return { status: "error", code: "EXPORT_MAPPING_INVALID" };
  }
  const rows = questions as QuestionExportRow[];

  // D012/D021/D023: every question must be a deliberate decision before the
  // workbook leaves the building.
  const readiness = summarizeExportReadiness(rows);
  if (readiness.total === 0 || readiness.unresolved > 0) {
    return { status: "error", code: "QUESTIONNAIRE_NOT_RESOLVED" };
  }
  if (!rows.some((row) => row.answer_cell !== null)) {
    return { status: "error", code: "EXPORT_MAPPING_INVALID" };
  }

  const { data: object, error: downloadError } = await supabase.storage
    .from("questionnaires")
    .download(file.storage_path);
  if (downloadError !== null || object === null) {
    logger.warn("export original download failed", { code: "STORAGE_UNAVAILABLE" });
    return { status: "error", code: "STORAGE_UNAVAILABLE" };
  }
  const original = new Uint8Array(await object.arrayBuffer());

  // Pre-write integrity (plan §9: refuse when mappings no longer match).
  const expectations: ExportCellExpectation[] = rows.map((row) => ({
    sheetName: row.sheet_name,
    rowNumber: row.row_number,
    questionCell: row.question_cell,
    expectedText: row.question_original,
  }));
  const csv = csvMetadataOf(file.metadata);
  if (format === "csv" && csv === null) {
    return { status: "error", code: "EXPORT_MAPPING_INVALID" };
  }
  const verification = await verifyOriginalCells({
    original,
    format,
    expectations,
    // exactOptionalPropertyTypes: the key is only present when it has a value.
    ...(csv !== null ? { csv } : {}),
  });
  if (!verification.ok) {
    logger.warn("export cell verification refused", { code: verification.code });
    return { status: "error", code: verification.code };
  }

  const answerLocations: ExportAnswerLocation[] = rows
    .filter((row) => row.answer_cell !== null)
    .map((row) => {
      const status = row.answers?.status ?? row.status;
      const text = exportTextFor({
        blank_by_choice: row.blank_by_choice,
        status,
        current_text: row.answers?.current_text ?? "",
      });
      return {
        sheetName: row.sheet_name,
        rowNumber: row.row_number,
        answerCell: row.answer_cell as string,
        text,
      };
    });

  let summary: { sheetName: string; rows: ExportSummaryRow[] } | undefined;
  if (input.includeSummary) {
    summary = {
      sheetName: "QuestCite Summary",
      rows: rows.map((row) => {
        const status = row.answers?.status ?? row.status;
        return {
          question: row.question_original,
          answer: exportTextFor({
            blank_by_choice: row.blank_by_choice,
            status,
            current_text: row.answers?.current_text ?? "",
          }),
          status: row.blank_by_choice ? "blank_by_choice" : status,
          category: row.category,
        };
      }),
    };
  }

  const writtenResult = await writeAnswersToWorkbook({
    original,
    format,
    answers: answerLocations,
    ...(csv !== null ? { csv } : {}),
    ...(summary !== undefined ? { summary } : {}),
  });
  if (!writtenResult.ok) {
    logger.warn("export write failed", { code: writtenResult.code });
    return { status: "error", code: writtenResult.code };
  }
  const { bytes } = writtenResult.value;

  const checksum = createHash("sha256").update(bytes).digest("hex");
  const originalFilename = file.storage_path.split("/")[3] ?? "questionnaire";
  const filename = buildExportFilename(originalFilename, format, new Date());
  const exportId = crypto.randomUUID();
  // Same 4-segment shape as originals ({org}/{qn}/{id}/{filename}), so the
  // 0010 path validator and storage policies govern exports unchanged.
  const storagePath = `${input.organizationId}/${input.questionnaireId}/${exportId}/${filename}`;
  const mimeType = format === "csv"
    ? "text/csv"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  const { error: uploadError } = await supabase.storage.from("questionnaires").upload(storagePath, bytes, {
    contentType: mimeType,
  });
  if (uploadError !== null) {
    logger.warn("export upload denied", { code: uploadError.message.slice(0, 40) });
    return { status: "error", code: "STORAGE_UNAVAILABLE" };
  }

  const approvedCount = rows.filter((row) => (row.answers?.status ?? row.status) === "approved").length;
  const blankCount = rows.filter((row) => row.blank_by_choice).length;

  const { data: recordedId, error: recordError } = await supabase.rpc("record_questionnaire_export", {
    p_organization_id: input.organizationId,
    p_questionnaire_id: input.questionnaireId,
    p_export_id: exportId,
    p_storage_path: storagePath,
    p_filename: filename,
    p_format: format,
    p_mime_type: mimeType,
    p_byte_size: bytes.byteLength,
    p_checksum_sha256: checksum,
    p_question_count: readiness.total,
    p_approved_count: approvedCount,
    p_blank_count: blankCount,
    p_written_cell_count: writtenResult.value.written,
  });
  if (recordError !== null || typeof recordedId !== "string") {
    // The history row IS the export's receipt — without it the object is
    // orphaned; remove it so storage never accumulates unreferenced exports.
    await supabase.storage.from("questionnaires").remove([storagePath]);
    logger.warn("export record denied", { code: recordError?.message.slice(0, 40) ?? "NO_DATA" });
    return { status: "error", code: mapExportError(recordError?.message ?? "NO_DATA") };
  }

  return {
    status: "success",
    exportId,
    filename,
    checksum,
    written: writtenResult.value.written,
  };
}

/**
 * CSV transport metadata from questionnaire_files.metadata (insert-time only,
 * migration 0013/0023-style contract): `{ delimiter, bom }` for csv, `{}` for
 * xlsx. Anything else fails closed.
 */
function csvMetadataOf(metadata: unknown): { delimiter: string; bom: boolean } | null {
  if (metadata === null || typeof metadata !== "object") {
    return null;
  }
  const record = metadata as Record<string, unknown>;
  if (Object.keys(record).length === 0) {
    // xlsx carries `{}` — no CSV metadata needed.
    return null;
  }
  const delimiter = record.delimiter;
  const bom = record.bom;
  if (
    (delimiter !== "," && delimiter !== ";" && delimiter !== "\t" && delimiter !== "|")
    || typeof bom !== "boolean"
  ) {
    return null;
  }
  return { delimiter, bom };
}

function mapExportError(message: string): string {
  const known = [
    "QUESTIONNAIRE_NOT_FOUND",
    "QUESTIONNAIRE_STATE_INVALID",
    "EXPORT_INPUT_INVALID",
    "EXPORT_DUPLICATE",
    "FORBIDDEN",
    "AUTH_REQUIRED",
  ];
  const match = known.find((candidate) => message.includes(candidate));
  return match ?? "EXPORT_FAILED";
}
