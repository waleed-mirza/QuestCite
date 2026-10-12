import { NextResponse } from "next/server";

import type { Database } from "@/types/database.types";

import { MAX_DOCUMENT_BYTES } from "@/config/ingestion";
import { processDocumentVersion } from "@/features/documents/ingestion";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createDocumentUploadSchema,
  documentMimeSchema,
} from "@/lib/validation/document";
import { validateDocumentFile } from "@/lib/files/validate";
import { ForbiddenError, UnauthorizedError } from "@/server/errors";
import { requireOrgRole } from "@/server/authorization/org";

/**
 * Knowledge-document upload + synchronous ingestion (plan §9/§13 `api/uploads`).
 *
 * A route handler (not a Server Action) because file uploads exceed the
 * Server Action body limit. AuthZ is requireOrgRole(owner/admin) before any
 * work; every subsequent write goes through the user's own client, so RLS is
 * the final enforcement layer. Responses carry SAFE CODES + short copy only —
 * never storage paths, checksums of content, or parser output.
 */

export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  let orgSlug = "";
  try {
    const form = await request.formData();
    const file = form.get("file");
    const slugValue = form.get("orgSlug");
    if (!(file instanceof File) || typeof slugValue !== "string" || slugValue === "") {
      return NextResponse.json({ status: "error", code: "DOCUMENT_INPUT_INVALID" }, { status: 400 });
    }
    orgSlug = slugValue;

    const ctx = await requireOrgRole(["owner", "admin"], orgSlug);

    if (file.size > MAX_DOCUMENT_BYTES) {
      return NextResponse.json({ status: "error", code: "DOCUMENT_TOO_LARGE" }, { status: 413 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());

    const metadata = createDocumentUploadSchema.safeParse({
      title: optionalString(form.get("title")),
      category: optionalString(form.get("category")),
      tags: safeParseTags(form.get("tags")),
      reviewBy: optionalString(form.get("reviewBy")) ?? null,
      documentId: optionalString(form.get("documentId")) ?? null,
    });
    if (!metadata.success) {
      return NextResponse.json({ status: "error", code: "DOCUMENT_INPUT_INVALID" }, { status: 400 });
    }

    const mime = documentMimeSchema.safeParse(file.type);
    const validation = validateDocumentFile(bytes, file.name, mime.success ? mime.data : "unknown/unknown");
    if (!validation.ok) {
      return NextResponse.json({ status: "error", code: validation.code }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const actor = ctx.role;
    // supabase-js generated RPC arg types cannot express NULLABLE Postgres
    // parameters — `date`/`uuid` params are typed bare `string`, so the
    // Zod-validated nulls below need one narrow, reviewed assertion. The SQL
    // itself accepts NULL for both (see create_document_upload, migration 0003).
    const uploadArgs = {
      p_organization_id: ctx.organization.id,
      p_title: metadata.data.title,
      p_category: metadata.data.category,
      p_tags: metadata.data.tags,
      p_review_by: metadata.data.reviewBy,
      p_filename: validation.sanitizedFilename,
      p_mime_type: validation.mime,
      p_byte_size: validation.byteSize,
      p_checksum_sha256: validation.checksumSha256,
      p_document_id: metadata.data.documentId,
    } as Database["public"]["Functions"]["create_document_upload"]["Args"];
    const { data: rpcRows, error: rpcError } = await supabase.rpc("create_document_upload", uploadArgs);
    const intentRow = (rpcRows as Array<{ document_id: string; version_id: string; storage_path: string }> | null)?.[0];
    if (rpcError !== null || intentRow === undefined) {
      logger.warn("upload intent rpc failed", { role: actor, code: rpcError?.message.slice(0, 40) ?? "none" });
      return NextResponse.json({ status: "error", code: mapRpcError(rpcError?.message ?? "") }, { status: 400 });
    }

    // Storage upload happens through the SAME user client — the storage RLS
    // policies verify the org from the first path segment (plan §7).
    const uploaded = await supabase.storage
      .from("documents")
      .upload(intentRow.storage_path, bytes, { contentType: validation.mime });
    if (uploaded.error !== null) {
      logger.warn("storage upload failed", { code: uploaded.error.message.slice(0, 40) });
      return NextResponse.json({ status: "error", code: "STORAGE_UPLOAD_FAILED" }, { status: 502 });
    }

    const ready = await processDocumentVersion({
      organizationId: ctx.organization.id,
      documentId: intentRow.document_id,
      versionId: intentRow.version_id,
      storagePath: intentRow.storage_path,
      expectedChecksum: validation.checksumSha256,
      kind: validation.kind,
    });

    return NextResponse.json({
      status: ready ? "ready" : "processing_failed",
      documentId: intentRow.document_id,
      versionId: intentRow.version_id,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ status: "error", code: "AUTH_REQUIRED" }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ status: "error", code: "FORBIDDEN" }, { status: 403 });
    }
    logger.warn("upload route failed", { slug: orgSlug.slice(0, 40), name: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ status: "error", code: "UPLOAD_FAILED" }, { status: 500 });
  }
}

function optionalString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function safeParseTags(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function mapRpcError(message: string): string {
  const code = message.trim();
  const known = [
    "DOCUMENT_INPUT_INVALID",
    "DOCUMENT_TYPE_UNSUPPORTED",
    "DOCUMENT_TOO_LARGE",
    "DOCUMENT_EMPTY",
    "DOCUMENT_NOT_FOUND",
    "VERSION_LIMIT_REACHED",
    "QUOTA_EXCEEDED",
    "ORG_INACTIVE",
    "FORBIDDEN",
  ];
  const match = known.find((candidate) => code.includes(candidate));
  return match ?? "UPLOAD_FAILED";
}
