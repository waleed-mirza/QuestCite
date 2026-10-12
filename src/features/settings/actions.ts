"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/observability/logger";
import { deletionConfirmationSchema, workspaceSettingsSchema } from "@/lib/validation/settings";
import { requireOrgRole } from "@/server/authorization/org";
import { isForbiddenError, isNotFoundError, isUnauthorizedError } from "@/server/errors";

export type SettingsActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function safeRpcMessage(message: string): string {
  const code = message.trim();
  if (code.includes("SETTINGS_INPUT_INVALID")) return "Check the retention value and try again.";
  if (code.includes("DELETE_CONFIRMATION_INVALID")) return "Type the workspace slug exactly to continue.";
  if (code.includes("DELETION_NOT_REQUESTED")) return "Request deletion before confirming the final deletion.";
  if (code.includes("FORBIDDEN")) return "You do not have permission to change these settings.";
  if (code.includes("ORG_NOT_FOUND")) return "Workspace not found.";
  return "We couldn't save that change. Please try again.";
}

export async function updateWorkspaceSettingsAction(
  orgSlug: string,
  _prev: SettingsActionState | null,
  formData: FormData,
): Promise<SettingsActionState> {
  try {
    const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
    const parsed = workspaceSettingsSchema.safeParse({
      retentionDays: text(formData, "retentionDays"),
      aiDraftsDisabled: formData.get("aiDraftsDisabled") === "on",
    });
    if (!parsed.success) return { status: "error", message: "Retention must be between 30 and 3,650 days." };
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("update_workspace_settings", {
      p_organization_id: ctx.organization.id,
      p_retention_days: parsed.data.retentionDays,
      p_ai_drafts_disabled: parsed.data.aiDraftsDisabled,
    });
    if (error !== null) return { status: "error", message: safeRpcMessage(error.message) };
    revalidatePath(`/app/${orgSlug}/settings`);
    return { status: "success", message: "Workspace settings saved." };
  } catch (error) {
    if (isUnauthorizedError(error)) return { status: "error", message: "Sign in to change workspace settings." };
    if (isForbiddenError(error)) return { status: "error", message: "Only workspace owners and admins can change settings." };
    if (isNotFoundError(error)) return { status: "error", message: "Workspace not found." };
    logger.warn("settings.update_failed", { code: "SETTINGS_UPDATE_FAILED" });
    return { status: "error", message: "We couldn't save that change. Please try again." };
  }
}

export async function requestOrganizationDeletionAction(
  orgSlug: string,
  _prev: SettingsActionState | null,
  formData: FormData,
): Promise<SettingsActionState> {
  try {
    const ctx = await requireOrgRole(["owner"], orgSlug);
    const confirmation = deletionConfirmationSchema.safeParse(text(formData, "confirmation"));
    if (!confirmation.success || confirmation.data.toLowerCase() !== ctx.organization.slug.toLowerCase()) {
      return { status: "error", message: "Type the workspace slug exactly to request deletion." };
    }
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("request_organization_deletion", {
      p_organization_id: ctx.organization.id,
      p_confirmation_slug: confirmation.data,
    });
    if (error !== null) return { status: "error", message: safeRpcMessage(error.message) };
    revalidatePath(`/app/${orgSlug}/settings`);
    return { status: "success", message: "Deletion requested. Confirm below to permanently delete the workspace." };
  } catch (error) {
    return settingsError(error, "settings.deletion_request_failed", "We couldn't request deletion. Please try again.");
  }
}

export async function cancelOrganizationDeletionAction(
  orgSlug: string,
  previous: SettingsActionState | null,
  formData: FormData,
): Promise<SettingsActionState> {
  void previous;
  void formData;
  try {
    const ctx = await requireOrgRole(["owner"], orgSlug);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("cancel_organization_deletion", { p_organization_id: ctx.organization.id });
    if (error !== null) return { status: "error", message: safeRpcMessage(error.message) };
    revalidatePath(`/app/${orgSlug}/settings`);
    return { status: "success", message: "Deletion request cancelled." };
  } catch (error) {
    return settingsError(error, "settings.deletion_cancel_failed", "We couldn't cancel deletion. Please try again.");
  }
}

export async function deleteOrganizationAction(
  orgSlug: string,
  _prev: SettingsActionState | null,
  formData: FormData,
): Promise<SettingsActionState> {
  try {
    const ctx = await requireOrgRole(["owner"], orgSlug);
    const confirmation = deletionConfirmationSchema.safeParse(text(formData, "confirmation"));
    if (!confirmation.success || confirmation.data.toLowerCase() !== ctx.organization.slug.toLowerCase()) {
      return { status: "error", message: "Type the workspace slug exactly to permanently delete it." };
    }

    const supabase = await createSupabaseServerClient();
    const storagePaths = await collectStoragePaths(supabase, ctx.organization.id);
    const { data: deleted, error } = await supabase.rpc("delete_organization", {
      p_organization_id: ctx.organization.id,
      p_confirmation_slug: confirmation.data,
    });
    if (error !== null || deleted !== true) {
      return { status: "error", message: error === null ? "The workspace was not deleted." : safeRpcMessage(error.message) };
    }

    if (storagePaths.length > 0) {
      try {
        const admin = createSupabaseAdminClient();
        const [documentPaths, questionnairePaths] = await Promise.all([
          Promise.resolve(storagePaths.filter((path) => path.bucket === "documents").map((path) => path.path)),
          Promise.resolve(storagePaths.filter((path) => path.bucket === "questionnaires").map((path) => path.path)),
        ]);
        if (documentPaths.length > 0) await admin.storage.from("documents").remove(documentPaths);
        if (questionnairePaths.length > 0) await admin.storage.from("questionnaires").remove(questionnairePaths);
      } catch {
        logger.warn("settings.storage_cleanup_failed", { organizationId: ctx.organization.id, code: "STORAGE_CLEANUP_FAILED" });
      }
    }
    return { status: "success", message: "Workspace deleted. You can create a new workspace from the onboarding page." };
  } catch (error) {
    return settingsError(error, "settings.deletion_failed", "We couldn't delete the workspace. Please try again.");
  }
}

type StoragePath = { bucket: "documents" | "questionnaires"; path: string };

async function collectStoragePaths(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
): Promise<StoragePath[]> {
  const [documents, questionnaireFiles] = await Promise.all([
    supabase.from("document_versions").select("storage_path").eq("organization_id", organizationId),
    supabase.from("questionnaire_files").select("storage_path,exported_storage_path").eq("organization_id", organizationId),
  ]);
  if (documents.error !== null || questionnaireFiles.error !== null) {
    throw new Error("STORAGE_PATHS_UNAVAILABLE");
  }
  return [
    ...(documents.data ?? []).map((row) => ({ bucket: "documents" as const, path: row.storage_path })),
    ...(questionnaireFiles.data ?? []).flatMap((row) => [
      { bucket: "questionnaires" as const, path: row.storage_path },
      ...(row.exported_storage_path === null ? [] : [{ bucket: "questionnaires" as const, path: row.exported_storage_path }]),
    ]),
  ];
}

function settingsError(error: unknown, logMessage: string, fallback: string): SettingsActionState {
  if (isUnauthorizedError(error)) return { status: "error", message: "Sign in to manage this workspace." };
  if (isForbiddenError(error)) return { status: "error", message: "Only the workspace owner can perform this action." };
  if (isNotFoundError(error)) return { status: "error", message: "Workspace not found." };
  logger.warn(logMessage, { code: "SETTINGS_ACTION_FAILED" });
  return { status: "error", message: fallback };
}
