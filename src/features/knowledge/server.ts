import "server-only";

import type { Database } from "@/types/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Read models for knowledge entries (PRD §6: short approved Q&A pairs, the
 * preferred evidence class). RLS scopes every row; the org filter keeps
 * multi-org members' lists unambiguous. Search covers question + answer
 * (generated tsvector), category, and review state (plan §W3: "search across
 * title, content, category, and status").
 */

type EntryRow = Database["public"]["Tables"]["knowledge_entries"]["Row"];

export type EntryListItem = EntryRow & { versionCount: number };

export const ENTRY_REVIEW_STATES = ["draft", "approved", "needs_review", "retired"] as const;

export type EntryListFilters = {
  /** Free-text: full-text over question + answer, falling back to question ILIKE. */
  query: string;
  category: string;
  reviewState: (typeof ENTRY_REVIEW_STATES)[number] | "all";
};

export async function listKnowledgeEntries(organizationId: string, filters: EntryListFilters): Promise<EntryListItem[]> {
  const supabase = await createSupabaseServerClient();

  // Content match first (question + answer via the generated tsvector), the
  // same pattern as document search. A textSearch failure (odd query syntax)
  // leaves matchedIds null so the list falls back to a question ILIKE instead
  // of blanking the library.
  let matchedIds: string[] | null = null;
  if (filters.query.trim() !== "") {
    const { data: matched, error } = await supabase
      .from("knowledge_entries")
      .select("id")
      .eq("organization_id", organizationId)
      .textSearch("search_vector", filters.query.trim(), { type: "websearch" })
      .limit(200);
    if (error === null) {
      matchedIds = (matched ?? []).map((row) => row.id);
    }
  }

  let list = supabase
    .from("knowledge_entries")
    .select("*")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (filters.category.trim() !== "") {
    list = list.eq("category", filters.category.trim());
  }
  if (filters.reviewState !== "all") {
    list = list.eq("review_state", filters.reviewState);
  }
  if (matchedIds !== null) {
    if (matchedIds.length === 0) {
      return [];
    }
    list = list.in("id", matchedIds);
  } else if (filters.query.trim() !== "") {
    list = list.ilike("question", `%${filters.query.trim()}%`);
  }

  const { data: entries, error } = await list;
  if (error !== null || entries === null) {
    return [];
  }
  if (entries.length === 0) {
    return [];
  }

  const { data: versions } = await supabase
    .from("knowledge_entry_versions")
    .select("entry_id")
    .in("entry_id", entries.map((entry) => entry.id));
  const counts = new Map<string, number>();
  for (const version of versions ?? []) {
    counts.set(version.entry_id, (counts.get(version.entry_id) ?? 0) + 1);
  }

  return entries.map((entry) => ({ ...entry, versionCount: counts.get(entry.id) ?? 0 }));
}

export async function listEntryCategories(organizationId: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("knowledge_entries")
    .select("category")
    .eq("organization_id", organizationId)
    .limit(500);
  return [...new Set((data ?? []).map((row) => row.category))].sort().slice(0, 30);
}

export async function getEntryWithHistory(
  organizationId: string,
  entryId: string,
): Promise<{ entry: EntryRow; versions: Database["public"]["Tables"]["knowledge_entry_versions"]["Row"][] } | null> {
  const supabase = await createSupabaseServerClient();
  const { data: entry, error } = await supabase
    .from("knowledge_entries")
    .select("*")
    .eq("id", entryId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error !== null || entry === null) {
    return null;
  }
  const { data: versions, error: versionsError } = await supabase
    .from("knowledge_entry_versions")
    .select("*")
    .eq("entry_id", entryId)
    .order("version_number", { ascending: false });
  if (versionsError !== null || versions === null) {
    return null;
  }
  return { entry, versions };
}
