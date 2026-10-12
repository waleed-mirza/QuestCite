/**
 * Knowledge + document read models: search breadth (content tsvector with
 * question-ILIKE fallback), category/review-state filters, org scoping on
 * every query, version-count aggregation, and owner-name resolution.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = { data: unknown; error: unknown; count?: number | null };
type LoggedQuery = {
  table: string;
  filters: Array<{ column: string; op: string; value: unknown }>;
  selects: string[];
  executed: boolean;
};

const queries: LoggedQuery[] = [];
let tableResults: Record<string, QueryResult | QueryResult[]> = {};

function resultFor(table: string): QueryResult {
  const configured = tableResults[table];
  if (Array.isArray(configured)) {
    return configured.shift() ?? { data: null, error: null };
  }
  return configured ?? { data: null, error: null };
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const entry: LoggedQuery = { table, filters: [], selects: [], executed: false };
      queries.push(entry);
      const chain = {
        select: (columns: string) => {
          entry.selects.push(columns);
          return chain;
        },
        eq: (column: string, value: unknown) => {
          entry.filters.push({ column, op: "eq", value });
          return chain;
        },
        ilike: (column: string, value: unknown) => {
          entry.filters.push({ column, op: "ilike", value });
          return chain;
        },
        in: (column: string, values: unknown) => {
          entry.filters.push({ column, op: "in", value: values });
          return chain;
        },
        textSearch: (column: string) => {
          entry.filters.push({ column, op: "textSearch", value: null });
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          entry.executed = true;
          return resultFor(table);
        },
        then: (onFulfilled: (value: QueryResult) => unknown) => {
          entry.executed = true;
          return Promise.resolve(resultFor(table)).then(onFulfilled);
        },
      };
      return chain;
    },
  }),
}));

import { getDocumentDetail } from "@/features/documents/server";
import { listKnowledgeEntries } from "@/features/knowledge/server";

const noFilters = { query: "", category: "", reviewState: "all" as const };

beforeEach(() => {
  queries.length = 0;
  tableResults = {};
});

describe("listKnowledgeEntries", () => {
  it("matches content first (question + answer tsvector) and filters the list to those ids", async () => {
    tableResults = {
      knowledge_entries: [
        { data: [{ id: "e1", question: "Q", answer: "A" }], error: null },
        { data: [{ id: "e1", question: "Q", answer: "A", category: "security", tags: [], review_state: "approved" }], error: null },
      ],
      knowledge_entry_versions: { data: [{ entry_id: "e1" }, { entry_id: "e1" }], error: null },
    };

    const entries = await listKnowledgeEntries("org-1", { ...noFilters, query: "encrypted" });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.versionCount).toBe(2);
    const contentQuery = queries[0];
    expect(contentQuery?.filters).toContainEqual({ column: "organization_id", op: "eq", value: "org-1" });
    expect(contentQuery?.filters).toContainEqual({ column: "search_vector", op: "textSearch", value: null });
    const listQuery = queries[1];
    expect(listQuery?.filters).toContainEqual({ column: "id", op: "in", value: ["e1"] });
  });

  it("returns nothing when the content match has zero hits", async () => {
    tableResults = { knowledge_entries: { data: [], error: null } };

    const entries = await listKnowledgeEntries("org-1", { ...noFilters, query: "zzz-nothing" });

    expect(entries).toEqual([]);
    // The zero-hit path returns before the list query is ever executed.
    expect(queries.filter((query) => query.executed)).toHaveLength(1);
  });

  it("falls back to a question ILIKE when the full-text query errors", async () => {
    tableResults = {
      knowledge_entries: [
        { data: null, error: { message: "syntax error in tsquery" } },
        { data: [], error: null },
      ],
    };

    await listKnowledgeEntries("org-1", { ...noFilters, query: "weird((query" });

    const listQuery = queries[1];
    expect(listQuery?.filters).not.toContainEqual({ column: "id", op: "in", value: [] });
    expect(listQuery?.filters).toContainEqual({ column: "question", op: "ilike", value: "%weird((query%" });
  });

  it("applies category and review-state filters without a query", async () => {
    tableResults = {
      knowledge_entries: { data: [], error: null },
    };

    await listKnowledgeEntries("org-1", { query: "", category: "security", reviewState: "approved" });

    const listQuery = queries[0];
    expect(listQuery?.filters).toContainEqual({ column: "category", op: "eq", value: "security" });
    expect(listQuery?.filters).toContainEqual({ column: "review_state", op: "eq", value: "approved" });
    expect(listQuery?.filters).toContainEqual({ column: "organization_id", op: "eq", value: "org-1" });
  });
});

describe("getDocumentDetail owner resolution", () => {
  const baseDoc = { id: "doc-1", owner_id: "user-1", tags: [] };

  it("resolves the owner's display name from profiles", async () => {
    tableResults = {
      documents: { data: baseDoc, error: null },
      document_versions: { data: [{ id: "v1", version_number: 1, processing_state: "ready" }], error: null },
      document_chunks: { data: null, error: null, count: 4 },
      profiles: { data: { full_name: "  Jane Doe  " }, error: null },
    };

    const detail = await getDocumentDetail("org-1", "doc-1");

    expect(detail?.ownerName).toBe("Jane Doe");
    expect(detail?.chunkCount).toBe(4);
    const chunkQuery = queries.find((query) => query.table === "document_chunks");
    expect(chunkQuery?.filters).toContainEqual({ column: "version_id", op: "eq", value: "v1" });
  });

  it("renders a departed owner (invisible profile) as no owner", async () => {
    tableResults = {
      documents: { data: baseDoc, error: null },
      document_versions: { data: [], error: null },
      profiles: { data: null, error: null },
    };

    const detail = await getDocumentDetail("org-1", "doc-1");

    expect(detail?.ownerName).toBeNull();
  });

  it("skips the profile lookup entirely when owner_id is null", async () => {
    tableResults = {
      documents: { data: { ...baseDoc, owner_id: null }, error: null },
      document_versions: { data: [], error: null },
    };

    const detail = await getDocumentDetail("org-1", "doc-1");

    expect(detail?.ownerName).toBeNull();
    expect(queries.some((query) => query.table === "profiles")).toBe(false);
  });

  it("scopes the document lookup to the organization", async () => {
    tableResults = {
      documents: { data: baseDoc, error: null },
      document_versions: { data: [], error: null },
    };

    await getDocumentDetail("org-1", "doc-1");

    const docQuery = queries.find((query) => query.table === "documents");
    expect(docQuery?.filters).toContainEqual({ column: "organization_id", op: "eq", value: "org-1" });
    expect(docQuery?.filters).toContainEqual({ column: "id", op: "eq", value: "doc-1" });
  });
});
