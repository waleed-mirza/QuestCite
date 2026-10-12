import { NextResponse } from "next/server";

import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ForbiddenError, UnauthorizedError } from "@/server/errors";
import { requireOrgRole } from "@/server/authorization/org";

/**
 * Answer version history (plan §W6 compare view): a read-only feed for the
 * question workspace. RLS scopes the rows to the caller's org; the explicit
 * role check allows every member role (viewers may read history).
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ questionId: string }> },
): Promise<NextResponse> {
  const { questionId } = await params;

  let slug = "";
  try {
    const supabase = await createSupabaseServerClient();
    const { data: rows, error } = await supabase
      .from("answer_versions")
      .select("id, version_number, text, creator_type, revision, created_at, author_id, questions(organization_id)")
      .eq("question_id", questionId)
      .order("version_number", { ascending: true })
      .limit(50);

    if (error !== null || rows === null) {
      logger.warn("version history query failed", { code: "QUERY_FAILED" });
      return NextResponse.json({ status: "error", code: "QUESTION_NOT_FOUND" }, { status: 404 });
    }
    // An empty list is a valid answer for a question with no content; a
    // foreign org's question id yields zero rows through RLS either way.
    const organizationId = (rows[0] as { questions: { organization_id: string } | null } | undefined)?.questions
      ?.organization_id;
    if (organizationId === undefined || organizationId === "") {
      return NextResponse.json({ status: "error", code: "QUESTION_NOT_FOUND" }, { status: 404 });
    }
    slug = await orgSlugFor(supabase, organizationId);
    if (slug === "") {
      return NextResponse.json({ status: "error", code: "QUESTION_NOT_FOUND" }, { status: 404 });
    }
    await requireOrgRole(["owner", "admin", "reviewer", "viewer"], slug);

    const authorIds = [...new Set(rows.map((row) => row.author_id).filter((id): id is string => id !== null))];
    const namesById = new Map<string, string>();
    if (authorIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", authorIds);
      for (const profile of profiles ?? []) {
        const fullName = profile.full_name.trim();
        if (fullName !== "") {
          namesById.set(profile.id, fullName);
        }
      }
    }

    return NextResponse.json({
      status: "success",
      versions: rows.map((row) => ({
        id: row.id,
        versionNumber: row.version_number,
        text: row.text,
        creatorType: row.creator_type,
        revision: row.revision,
        createdAt: row.created_at,
        authorName: row.author_id === null ? null : (namesById.get(row.author_id) ?? null),
      })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ status: "error", code: "AUTH_REQUIRED" }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ status: "error", code: "FORBIDDEN" }, { status: 403 });
    }
    logger.warn("version history route failed", { slug: slug.slice(0, 40) });
    return NextResponse.json({ status: "error", code: "HISTORY_FAILED" }, { status: 500 });
  }
}

async function orgSlugFor(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
): Promise<string> {
  const { data } = await supabase
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .maybeSingle();
  return data?.slug ?? "";
}
