import "server-only";

import { z } from "zod";

import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const workspaceSettingsRowSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  status: z.enum(["active", "deactivated"]),
  retention_days: z.number().int().min(30).max(3650),
  ai_drafts_disabled: z.boolean(),
  deletion_requested_at: z.string().nullable(),
});

export type WorkspaceSettings = z.infer<typeof workspaceSettingsRowSchema>;

export async function getWorkspaceSettings(organizationId: string): Promise<WorkspaceSettings | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id,name,slug,status,retention_days,ai_drafts_disabled,deletion_requested_at")
    .eq("id", organizationId)
    .maybeSingle();
  if (error !== null || data === null) {
    logger.warn("settings.read_failed", { organizationId, code: "SETTINGS_READ_FAILED" });
    return null;
  }
  const parsed = workspaceSettingsRowSchema.safeParse(data);
  if (!parsed.success) {
    logger.warn("settings.read_invalid", { organizationId, code: "SETTINGS_READ_INVALID" });
    return null;
  }
  return parsed.data;
}
const metadataExportSchema = z.object({
  exportVersion: z.literal(1),
  exportedAt: z.string(),
  organization: z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    status: z.enum(["active", "deactivated"]),
    retentionDays: z.number().int(),
    aiDraftsDisabled: z.boolean(),
    deletionRequestedAt: z.string().nullable(),
  }),
  counts: z.object({
    members: z.number().int().nonnegative(),
    documents: z.number().int().nonnegative(),
    questionnaires: z.number().int().nonnegative(),
  }),
});

export type WorkspaceMetadataExport = z.infer<typeof metadataExportSchema>;

/**
 * Export workspace metadata only. It deliberately omits document bytes,
 * document text, questionnaire questions, answers, prompts, and storage paths.
 */
export async function getWorkspaceMetadataExport(organizationId: string): Promise<WorkspaceMetadataExport | null> {
  const supabase = await createSupabaseServerClient();
  const settings = await getWorkspaceSettings(organizationId);
  if (settings === null) return null;

  const [members, documents, questionnaires] = await Promise.all([
    supabase.from("organization_members").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    supabase.from("questionnaires").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
  ]);
  if (members.error !== null || documents.error !== null || questionnaires.error !== null) {
    logger.warn("settings.export_failed", { organizationId, code: "SETTINGS_EXPORT_FAILED" });
    return null;
  }

  const exportData: WorkspaceMetadataExport = {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    organization: {
      id: settings.id,
      name: settings.name,
      slug: settings.slug,
      status: settings.status,
      retentionDays: settings.retention_days,
      aiDraftsDisabled: settings.ai_drafts_disabled,
      deletionRequestedAt: settings.deletion_requested_at,
    },
    counts: {
      members: members.count ?? 0,
      documents: documents.count ?? 0,
      questionnaires: questionnaires.count ?? 0,
    },
  };
  const parsed = metadataExportSchema.safeParse(exportData);
  return parsed.success ? parsed.data : null;
}
