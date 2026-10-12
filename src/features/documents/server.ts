import "server-only";

import type { Database } from "@/types/database.types";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Read models for the documents surface. All queries run through the user's
 * own client — RLS scopes every row to the caller's organizations, so the
 * org guard in the page is UX; the database is the boundary.
 */

type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
type VersionRow = Database["public"]["Tables"]["document_versions"]["Row"];

export type DocumentListItem = DocumentRow & {
  currentVersion: Pick<
    VersionRow,
    "id" | "version_number" | "processing_state" | "processing_error_code" | "mime_type" | "byte_size" | "created_at" | "page_count" | "char_count"
  > | null;
  versionCount: number;
};

export type DocumentListFilters = {
  /** Free-text: matches title (ILIKE) or chunk content (full-text). */
  query: string;
  category: string;
  state: "active" | "archived" | "all";
};

export async function listDocuments(organizationId: string, filters: DocumentListFilters): Promise<DocumentListItem[]> {
  const supabase = await createSupabaseServerClient();

  // Content search first: chunk full-text match → document ids. Scoped to the
  // org explicitly — RLS alone would happily return the caller's rows from
  // ALL their organizations.
  let contentMatchedIds: string[] | null = null;
  if (filters.query.trim() !== "") {
    const { data: chunkRows, error: chunkError } = await supabase
      .from("document_chunks")
      .select("document_id")
      .eq("organization_id", organizationId)
      .textSearch("search_vector", filters.query.trim(), { type: "websearch" })
      .limit(200);
    if (chunkError !== null) {
      return [];
    }
    contentMatchedIds = [...new Set((chunkRows ?? []).map((row) => row.document_id))];
    if (contentMatchedIds.length === 0) {
      return [];
    }
  }

  let query = supabase
    .from("documents")
    .select("*")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (filters.state !== "all") {
    query = query.eq("state", filters.state);
  }
  if (filters.category.trim() !== "") {
    query = query.eq("category", filters.category.trim());
  }
  if (contentMatchedIds !== null) {
    query = query.in("id", contentMatchedIds);
  } else if (filters.query.trim() !== "") {
    query = query.ilike("title", `%${filters.query.trim()}%`);
  }

  const { data: docs, error } = await query;
  if (error !== null || docs === null) {
    logger.warn("document list query failed", { code: error?.message.slice(0, 60) ?? "no-data" });
    return [];
  }

  if (docs.length === 0) {
    return [];
  }
  const { data: versions, error: versionsError } = await supabase
    .from("document_versions")
    .select("id, document_id, version_number, processing_state, processing_error_code, mime_type, byte_size, created_at, page_count, char_count")
    .in("document_id", docs.map((doc) => doc.id))
    .order("version_number", { ascending: false });
  if (versionsError !== null) {
    logger.warn("document versions query failed", { code: versionsError.message.slice(0, 60) });
    return [];
  }

  return docs.map((doc) => {
    const docVersions = (versions ?? []).filter((version) => version.document_id === doc.id);
    return {
      ...doc,
      currentVersion: docVersions[0] ?? null,
      versionCount: docVersions.length,
    };
  });
}

export type DocumentDetail = {
  document: DocumentRow;
  versions: VersionRow[];
  chunkCount: number | null;
  /** Display name of the owning member; null when they left the org (or row is invisible to RLS). */
  ownerName: string | null;
};

export async function getDocumentDetail(organizationId: string, documentId: string): Promise<DocumentDetail | null> {
  const supabase = await createSupabaseServerClient();

  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (docError !== null || doc === null) {
    return null;
  }

  const { data: versions, error: versionsError } = await supabase
    .from("document_versions")
    .select("*")
    .eq("document_id", documentId)
    .order("version_number", { ascending: false });
  if (versionsError !== null || versions === null) {
    return null;
  }

  const currentVersion = versions.find((version) => version.processing_state === "ready") ?? null;
  let chunkCount: number | null = null;
  if (currentVersion !== null) {
    const { count } = await supabase
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("version_id", currentVersion.id);
    chunkCount = count ?? 0;
  }

  // owner_id points at auth.users, not profiles (no FK to nest on) — resolve
  // the display name separately. The co-member SELECT policy makes a departed
  // owner's profile invisible, which renders as "former member" (no leak).
  let ownerName: string | null = null;
  if (doc.owner_id !== null) {
    const { data: ownerProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", doc.owner_id)
      .maybeSingle();
    const fullName = ownerProfile?.full_name.trim() ?? "";
    ownerName = fullName !== "" ? fullName : null;
  }

  return { document: doc, versions, chunkCount, ownerName };
}

export async function listCategories(organizationId: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documents")
    .select("category")
    .eq("organization_id", organizationId)
    .limit(500);
  if (error !== null) {
    logger.warn("document categories query failed", { code: error.message.slice(0, 60) });
  }
  return [...new Set((data ?? []).map((row) => row.category))].sort().slice(0, 30);
}
