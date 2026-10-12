"use server";

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { runQuestionnaireExport } from "@/features/questionnaires/export-service";
import { requireOrgRole } from "@/server/authorization/org";

/**
 * Export action (plan §W6): runs the final export pipeline server-side and,
 * on success, hands the NEW export's download URL back to the panel — the
 * browser then performs a plain navigation to the route handler, which issues
 * the short-lived signed URL. The action deliberately does not redirect:
 * a download is not a page navigation, and the panel refreshes the history
 * list itself.
 */

export type ExportActionResult =
  | { status: "success"; exportId: string; filename: string }
  | { status: "error"; code: string };

export async function exportQuestionnaireAction(
  orgSlug: string,
  questionnaireId: string,
  _prev: ExportActionResult | null,
  formData: FormData,
): Promise<ExportActionResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(questionnaireId)) {
    return { status: "error", code: "QUESTIONNAIRE_NOT_FOUND" };
  }
  const ctx = await requireOrgRole(["owner", "admin", "reviewer"], orgSlug);
  const includeSummary = formData.get("includeSummary") === "on";

  const outcome = await runQuestionnaireExport({
    organizationId: ctx.organization.id,
    questionnaireId,
    includeSummary,
  });
  if (outcome.status === "error") {
    logger.warn("questionnaire export failed", { code: outcome.code });
    return { status: "error", code: outcome.code };
  }

  revalidatePath(`/app/${orgSlug}/questionnaires/${questionnaireId}`);
  return { status: "success", exportId: outcome.exportId, filename: outcome.filename };
}
