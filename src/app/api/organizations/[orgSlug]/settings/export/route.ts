import { NextResponse } from "next/server";

import { getWorkspaceMetadataExport } from "@/features/settings/server";
import { guardOrgRoles } from "@/server/authorization/guard";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
): Promise<NextResponse> {
  const { orgSlug } = await params;
  const guard = await guardOrgRoles(orgSlug, ["owner"]);
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return NextResponse.json({ status: "error", code: "AUTH_REQUIRED" }, { status: 401 });
    if (guard.reason === "forbidden") return NextResponse.json({ status: "error", code: "FORBIDDEN" }, { status: 403 });
    return NextResponse.json({ status: "error", code: "NOT_FOUND" }, { status: 404 });
  }
  const data = await getWorkspaceMetadataExport(guard.ctx.organization.id);
  if (data === null) return NextResponse.json({ status: "error", code: "EXPORT_FAILED" }, { status: 503 });
  const safeSlug = guard.ctx.organization.slug.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
  return NextResponse.json(data, {
    headers: {
      "Content-Disposition": `attachment; filename="workspace-${safeSlug}-metadata.json"`,
      "Cache-Control": "no-store",
    },
  });
}
