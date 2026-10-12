import { NextResponse } from "next/server";

import { logger } from "@/lib/observability/logger";
import { prospectContextFromHeaders } from "@/lib/security/request-context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeTrustDownload } from "@/server/services/trust-public";

/**
 * Gated public download (plan §W7 "per-document access grants and
 * short-lived signed downloads"): the trust RPC validates EVERYTHING
 * (published center, token hash, approved unexpired request, per-document
 * active unexpired grant, current terms acceptance) and writes the download
 * event; only then does this route sign the private storage object with the
 * server-only service client (the anon/authenticated path can never sign
 * another tenant's object) and redirect. The signed URL lives 60 seconds and
 * is never logged.
 */

const SIGNED_URL_SECONDS = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; documentId: string }> },
): Promise<NextResponse> {
  const { slug, documentId } = await params;
  const rawToken = new URL(request.url).searchParams.get("token") ?? "";

  if (rawToken === "" || !/^[0-9a-f-]{36}$/.test(documentId)) {
    return NextResponse.json({ status: "error", code: "DOWNLOAD_NOT_ALLOWED" }, { status: 403 });
  }

  try {
    const context = prospectContextFromHeaders(request.headers);
    const authorization = await authorizeTrustDownload(slug, rawToken, documentId, context);
    if (authorization.status === "expired") {
      return NextResponse.json({ status: "error", code: "ACCESS_LINK_EXPIRED" }, { status: 410 });
    }
    if (authorization.status !== "ok") {
      return NextResponse.json({ status: "error", code: "DOWNLOAD_NOT_ALLOWED" }, { status: 403 });
    }

    const admin = createSupabaseAdminClient();
    const signed = await admin.storage
      .from("documents")
      .createSignedUrl(authorization.storagePath, SIGNED_URL_SECONDS, {
        download: authorization.filename,
      });
    if (signed.error !== null || signed.data === null) {
      logger.warn("trust signed url issuance failed", {
        slug: slug.slice(0, 40),
        code: "STORAGE_SIGN_FAILED",
      });
      return NextResponse.json({ status: "error", code: "DOWNLOAD_FAILED" }, { status: 502 });
    }
    return NextResponse.redirect(signed.data.signedUrl, { status: 302 });
  } catch (error) {
    if (error instanceof Error && error.message === "SERVICE_CLIENT_UNCONFIGURED") {
      logger.warn("trust download attempted without service client configured", { slug: slug.slice(0, 40) });
      return NextResponse.json({ status: "error", code: "DOWNLOAD_UNAVAILABLE" }, { status: 503 });
    }
    logger.warn("trust download route failed", { slug: slug.slice(0, 40) });
    return NextResponse.json({ status: "error", code: "DOWNLOAD_FAILED" }, { status: 500 });
  }
}
