import { NextResponse } from "next/server";

import type { Database } from "@/types/database.types";

import { MAX_QUESTIONNAIRE_FILE_BYTES } from "@/config/questionnaires";
import { inspectWorkbook } from "@/lib/files/questionnaire/inspect";
import {
  csvFileMetadataSchema,
  createQuestionnaireUploadSchema,
  xlsxFileMetadataSchema,
} from "@/lib/validation/questionnaire";
import { validateQuestionnaireFile } from "@/lib/files/questionnaire/validate";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ForbiddenError, UnauthorizedError } from "@/server/errors";
import { requireOrgRole } from "@/server/authorization/org";

/**
 * Questionnaire upload — the import entry point (plan §9, PRD §7.1).
 *
 * A route handler (not a Server Action) because files run to the 10 MB
 * ceiling while Server Action bodies cap far below it (same reason as the
 * documents route). Permission matrix: owner/admin/reviewer import (plan §4).
 *
 * Order: validate bytes (extension/MIME/magic) → inspect IN MEMORY (zip
 * safety scan + parser) → create rows with the CSV transport metadata in the
 * SAME insert (questionnaire_files.metadata is insert-immutable by the 0010
 * trigger, so 0013 carries it through create_questionnaire_upload) → store
 * the original byte-for-byte under the server-built path. The mapping screen
 * later re-reads THIS stored object — what the user confirms against is
 * exactly what was parsed and stored.
 *
 * Responses carry SAFE CODES + short copy only — never storage paths,
 * checksums, parser output, or workbook content.
 */

export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  let orgSlug = "";
  try {
    const form = await request.formData();
    const file = form.get("file");
    const slugValue = form.get("orgSlug");
    if (!(file instanceof File) || typeof slugValue !== "string" || slugValue === "") {
      return NextResponse.json({ status: "error", code: "QUESTIONNAIRE_INPUT_INVALID" }, { status: 400 });
    }
    orgSlug = slugValue;

    const ctx = await requireOrgRole(["owner", "admin", "reviewer"], orgSlug);

    if (file.size > MAX_QUESTIONNAIRE_FILE_BYTES) {
      return NextResponse.json({ status: "error", code: "QUESTIONNAIRE_TOO_LARGE" }, { status: 413 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());

    const metadata = createQuestionnaireUploadSchema.safeParse({
      title: optionalString(form.get("title")),
      customer: optionalString(form.get("customer")) ?? "",
      dueDate: optionalString(form.get("dueDate")) ?? null,
    });
    if (!metadata.success) {
      return NextResponse.json({ status: "error", code: "QUESTIONNAIRE_INPUT_INVALID" }, { status: 400 });
    }

    const mime = file.type === "" ? "unknown/unknown" : file.type;
    const validation = validateQuestionnaireFile(bytes, file.name, mime);
    if (!validation.ok) {
      return NextResponse.json({ status: "error", code: validation.code }, { status: 400 });
    }

    // Inspect BEFORE the rows exist: the transport metadata ({delimiter, bom}
    // for csv, {} for xlsx) can only enter questionnaire_files at insert time.
    // The zip safety scan runs inside the inspector — a macro/encrypted
    // package is rejected before any parse attempt.
    const inspection = await inspectWorkbook(bytes, validation.format);
    if (!inspection.ok) {
      return NextResponse.json({ status: "error", code: inspection.code }, { status: 400 });
    }
    const fileMetadata = validation.format === "csv"
      ? csvFileMetadataSchema.safeParse({
          delimiter: inspection.value.csv?.delimiter ?? ",",
          bom: inspection.value.csv?.bom ?? false,
        })
      : xlsxFileMetadataSchema.safeParse({});
    if (!fileMetadata.success) {
      return NextResponse.json({ status: "error", code: "QUESTIONNAIRE_INPUT_INVALID" }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    // Generated RPC arg types cannot express a NULLABLE Postgres parameter —
    // `p_due_date` arrives typed bare `string`, so the Zod-validated null
    // needs one narrow, reviewed assertion (same documented limitation as the
    // documents route). The SQL accepts NULL (create_questionnaire_upload).
    const uploadArgs = {
      p_organization_id: ctx.organization.id,
      p_title: metadata.data.title,
      p_customer: metadata.data.customer,
      p_due_date: metadata.data.dueDate,
      p_filename: validation.sanitizedFilename,
      p_mime_type: validation.mime,
      p_byte_size: validation.byteSize,
      p_checksum_sha256: validation.checksumSha256,
      p_metadata: fileMetadata.data,
    } as Database["public"]["Functions"]["create_questionnaire_upload"]["Args"];
    const { data: rpcRows, error: rpcError } = await supabase.rpc("create_questionnaire_upload", uploadArgs);
    const intentRow = (
      rpcRows as Array<{ questionnaire_id: string; file_id: string; storage_path: string }> | null
    )?.[0];
    if (rpcError !== null || intentRow === undefined) {
      logger.warn("questionnaire upload intent rpc failed", {
        role: ctx.role,
        code: rpcError?.message.slice(0, 40) ?? "none",
      });
      return NextResponse.json({ status: "error", code: mapRpcError(rpcError?.message ?? "") }, { status: 400 });
    }

    // Storage upload happens through the SAME user client — the storage RLS
    // policies verify the org from the first path segment (plan §7). On
    // failure the 'importing' questionnaire stays as the visible record of
    // the failed import; owners/admins can delete it from the list.
    const uploaded = await supabase.storage
      .from("questionnaires")
      .upload(intentRow.storage_path, bytes, { contentType: validation.mime });
    if (uploaded.error !== null) {
      logger.warn("questionnaire storage upload failed", { code: uploaded.error.message.slice(0, 40) });
      return NextResponse.json(
        { status: "error", code: "STORAGE_UPLOAD_FAILED", questionnaireId: intentRow.questionnaire_id },
        { status: 502 },
      );
    }

    return NextResponse.json({ status: "ok", questionnaireId: intentRow.questionnaire_id });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ status: "error", code: "AUTH_REQUIRED" }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ status: "error", code: "FORBIDDEN" }, { status: 403 });
    }
    logger.warn("questionnaire upload route failed", {
      slug: orgSlug.slice(0, 40),
      name: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ status: "error", code: "UPLOAD_FAILED" }, { status: 500 });
  }
}

function optionalString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function mapRpcError(message: string): string {
  const code = message.trim();
  const known = [
    "QUESTIONNAIRE_INPUT_INVALID",
    "QUESTIONNAIRE_TYPE_UNSUPPORTED",
    "QUESTIONNAIRE_TOO_LARGE",
    "QUESTIONNAIRE_EMPTY",
    "QUOTA_EXCEEDED",
    "ORG_INACTIVE",
    "FORBIDDEN",
  ];
  const match = known.find((candidate) => code.includes(candidate));
  return match ?? "UPLOAD_FAILED";
}
