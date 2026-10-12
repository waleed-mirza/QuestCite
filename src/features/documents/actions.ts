"use server";

import { revalidatePath } from "next/cache";

import { processDocumentVersion } from "@/features/documents/ingestion";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateDocumentSchema } from "@/lib/validation/document";
import { requireOrgRole } from "@/server/authorization/org";

/**
 * Document lifecycle actions (plan §W3, PRD §5: owner/admin manage evidence).
 * Every action re-checks role, and RLS re-checks tenancy on each statement —
 * the audit trail for these changes is written by the database triggers
 * (migration 0003), so an audit row commits with the change or not at all.
 */

export type DocumentActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

function documentPath(orgSlug: string, documentId: string): string {
  return `/app/${orgSlug}/documents/${documentId}`;
}

export async function updateDocumentAction(
  orgSlug: string,
  documentId: string,
  _prev: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);

  const parsed = updateDocumentSchema.safeParse({
    title: optionalText(formData.get("title")),
    category: optionalText(formData.get("category")),
    tags: parseTags(formData.get("tags")),
    reviewBy: blankToNull(formData.get("reviewBy")),
  });
  if (!parsed.success) {
    return { status: "error", message: "Check the fields — titles are limited to 200 characters." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("documents")
    .update({
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
      ...(parsed.data.tags !== undefined ? { tags: parsed.data.tags } : {}),
      ...(parsed.data.reviewBy !== undefined ? { review_by: parsed.data.reviewBy } : {}),
    })
    .eq("id", documentId)
    .eq("organization_id", ctx.organization.id)
    .select("id")
    .maybeSingle();

  if (error !== null || updated === null) {
    logger.warn("document update denied", { code: error?.message.slice(0, 40) ?? "no-row" });
    return { status: "error", message: "The document could not be updated." };
  }

  revalidatePath(documentPath(orgSlug, documentId));
  return { status: "success", message: "Saved." };
}

export async function archiveDocumentAction(orgSlug: string, formData: FormData): Promise<void> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const documentId = formData.get("documentId");
  if (typeof documentId !== "string" || documentId === "") {
    return;
  }
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("documents")
    .update({ state: "archived" })
    .eq("id", documentId)
    .eq("organization_id", ctx.organization.id);
  revalidatePath(documentPath(orgSlug, documentId));
  revalidatePath(`/app/${orgSlug}/documents`);
}

export async function restoreDocumentAction(orgSlug: string, formData: FormData): Promise<void> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const documentId = formData.get("documentId");
  if (typeof documentId !== "string" || documentId === "") {
    return;
  }
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("documents")
    .update({ state: "active" })
    .eq("id", documentId)
    .eq("organization_id", ctx.organization.id);
  revalidatePath(documentPath(orgSlug, documentId));
  revalidatePath(`/app/${orgSlug}/documents`);
}

/**
 * Deletes the document row (versions + chunks cascade; the lifecycle trigger
 * writes the audit event). Storage objects are then removed through the
 * caller's client — the storage delete policy re-verifies ownership from the
 * path, so a failed cleanup cannot delete someone else's objects and is
 * logged for a later sweep rather than blocking the delete.
 */
export async function deleteDocumentAction(orgSlug: string, formData: FormData): Promise<void> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const documentId = formData.get("documentId");
  if (typeof documentId !== "string" || documentId === "") {
    return;
  }
  const supabase = await createSupabaseServerClient();

  const { data: paths, error: pathsError } = await supabase
    .from("document_versions")
    .select("storage_path")
    .eq("document_id", documentId)
    .eq("organization_id", ctx.organization.id);

  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .eq("organization_id", ctx.organization.id);
  if (error !== null) {
    return;
  }

  const storagePaths = (paths ?? []).map((row) => row.storage_path);
  if (pathsError === null && storagePaths.length > 0) {
    const { error: storageError } = await supabase.storage.from("documents").remove(storagePaths);
    if (storageError !== null) {
      logger.warn("document storage cleanup failed", { count: storagePaths.length });
    }
  }

  revalidatePath(`/app/${orgSlug}/documents`);
}

/**
 * Retry: the RPC enforces the failed-state + attempt cap and wipes stale
 * chunks; the pipeline then runs again (idempotent by deterministic chunks +
 * the embedding cache).
 */
export async function retryIngestAction(orgSlug: string, documentId: string, formData: FormData): Promise<void> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const versionId = formData.get("versionId");
  if (typeof versionId !== "string" || versionId === "") {
    return;
  }
  const supabase = await createSupabaseServerClient();

  const { data: rows, error: rpcError } = await supabase.rpc("reset_document_version_for_retry", {
    p_organization_id: ctx.organization.id,
    p_document_id: documentId,
    p_version_id: versionId,
  });
  if (rpcError !== null) {
    logger.warn("retry reset denied", { code: rpcError.message.slice(0, 40) });
    revalidatePath(documentPath(orgSlug, documentId));
    return;
  }
  void rows;

  const { data: version } = await supabase
    .from("document_versions")
    .select("storage_path, mime_type, checksum_sha256")
    .eq("id", versionId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (version === null) {
    return;
  }

  const kind = version.mime_type === "application/pdf" ? "pdf"
    : version.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx"
    : version.mime_type === "text/markdown" ? "md"
    : "txt";

  await processDocumentVersion({
    organizationId: ctx.organization.id,
    documentId,
    versionId,
    storagePath: version.storage_path,
    expectedChecksum: version.checksum_sha256,
    kind,
  });

  revalidatePath(documentPath(orgSlug, documentId));
}

function optionalText(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function blankToNull(value: FormDataEntryValue | null): string | null | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.trim() === "" ? null : value.trim();
}

/** Parses a comma-separated tag list from a form field ("soc2, product"). */
function parseTags(value: FormDataEntryValue | null): string[] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const tags = value
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag !== "");
  return tags;
}
