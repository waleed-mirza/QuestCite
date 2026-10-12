import { NextResponse } from "next/server";

import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ForbiddenError, UnauthorizedError } from "@/server/errors";
import { requireOrgRole } from "@/server/authorization/org";

/**
 * Version download (plan §7): a short-lived signed URL is issued ONLY after
 * the app-level org-role check, and the storage service re-verifies the same
 * membership through its policies before honoring the token. The URL is
 * redirected to, never stored or logged.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string; versionId: string }> },
): Promise<NextResponse> {
  const { documentId, versionId } = await params;

  // Slug is not in this route — resolve the org through the version row (RLS
  // scopes it to the caller's organizations; the role check happens after we
  // know which org the version belongs to).
  let slug = "";
  try {
    const supabase = await createSupabaseServerClient();
    const { data: version, error } = await supabase
      .from("document_versions")
      .select("storage_path, organization_id, organizations(slug)")
      .eq("id", versionId)
      .eq("document_id", documentId)
      .maybeSingle();

    if (error !== null || version === null || version.organizations === null) {
      return NextResponse.json({ status: "error", code: "DOCUMENT_NOT_FOUND" }, { status: 404 });
    }
    const orgSlug = (version.organizations as { slug: string } | null)?.slug ?? "";
    if (orgSlug === "") {
      return NextResponse.json({ status: "error", code: "DOCUMENT_NOT_FOUND" }, { status: 404 });
    }
    slug = orgSlug;

    // Full member-level authz: viewers/reviewers may download, non-members
    // were already filtered out by RLS above.
    await requireOrgRole(["owner", "admin", "reviewer", "viewer"], orgSlug);

    const signed = await supabase.storage.from("documents").createSignedUrl(version.storage_path, 60);
    if (signed.error !== null || signed.data === null) {
      logger.warn("signed url issuance failed", { code: signed.error?.message.slice(0, 40) ?? "none" });
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
    logger.warn("download route failed", { slug: slug.slice(0, 40) });
    return NextResponse.json({ status: "error", code: "DOWNLOAD_FAILED" }, { status: 500 });
  }
}
