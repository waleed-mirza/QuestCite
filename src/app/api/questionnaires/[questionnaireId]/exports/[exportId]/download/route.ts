import { NextResponse } from "next/server";

import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ForbiddenError, UnauthorizedError } from "@/server/errors";
import { requireOrgRole } from "@/server/authorization/org";

/**
 * Export download (plan §W6 "short-lived download"): a signed URL is issued
 * ONLY after the app-level org-role check, and storage re-verifies membership
 * through its path-derived policies before honoring the token. The URL
 * expires in 60 seconds and carries the sanitized filename as its download
 * disposition; it is redirected to, never stored or logged.
 */

const SIGNED_URL_SECONDS = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ questionnaireId: string; exportId: string }> },
): Promise<NextResponse> {
  const { questionnaireId, exportId } = await params;

  let slug = "";
  try {
    const supabase = await createSupabaseServerClient();
    const { data: exportRow, error } = await supabase
      .from("questionnaire_exports")
      .select("storage_path, filename, organization_id, organizations(slug)")
      .eq("id", exportId)
      .eq("questionnaire_id", questionnaireId)
      .maybeSingle();

    if (error !== null || exportRow === null || exportRow.organizations === null) {
      return NextResponse.json({ status: "error", code: "EXPORT_NOT_FOUND" }, { status: 404 });
    }
    const orgSlug = (exportRow.organizations as { slug: string } | null)?.slug ?? "";
    if (orgSlug === "") {
      return NextResponse.json({ status: "error", code: "EXPORT_NOT_FOUND" }, { status: 404 });
    }
    slug = orgSlug;

    // Every role may download an export of their own org's questionnaire.
    await requireOrgRole(["owner", "admin", "reviewer", "viewer"], orgSlug);

    const signed = await supabase.storage
      .from("questionnaires")
      .createSignedUrl(exportRow.storage_path, SIGNED_URL_SECONDS, { download: exportRow.filename });
    if (signed.error !== null || signed.data === null) {
      logger.warn("export signed url issuance failed", { code: signed.error?.message.slice(0, 40) ?? "none" });
      return NextResponse.json({ status: "error", code: "DOWNLOAD_FAILED" }, { status: 502 });
    }
    return NextResponse.redirect(signed.data.signedUrl, { status: 302 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ status: "error", code: "AUTH_REQUIRED" }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ status: "error", code: "FORBIDDEN" }, { status: 403 });
    }
    logger.warn("export download route failed", { slug: slug.slice(0, 40) });
    return NextResponse.json({ status: "error", code: "DOWNLOAD_FAILED" }, { status: 500 });
  }
}
