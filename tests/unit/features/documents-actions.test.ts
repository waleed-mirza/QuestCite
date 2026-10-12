/**
 * Document lifecycle actions: metadata updates (validation + org scoping),
 * archive/restore, delete with storage cleanup, and the retry flow (RPC
 * failure must never trigger the pipeline; success maps MIME → parser kind).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  ctx: { organization: { id: string; name: string; slug: string }; role: "owner" | "admin" };
  rpcError: { message: string } | null;
  pipelineCalls: Array<{ kind: string; documentId: string; versionId: string }>;
  revalidated: string[];
} = {
  ctx: { organization: { id: "org-1", name: "Org", slug: "org" }, role: "owner" },
  rpcError: null,
  pipelineCalls: [],
  revalidated: [],
};

vi.mock("@/server/authorization/org", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/authorization/org")>();
  return {
    ...actual,
    requireOrgRole: async () => state.ctx,
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    state.revalidated.push(path);
  },
}));

vi.mock("@/features/documents/ingestion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/documents/ingestion")>();
  return {
    ...actual,
    processDocumentVersion: async (ref: { documentId: string; versionId: string; kind: string }) => {
      state.pipelineCalls.push({ kind: ref.kind, documentId: ref.documentId, versionId: ref.versionId });
      return true;
    },
  };
});

type QueryResult = { data: unknown; error: unknown; count?: number | null };
type LoggedQuery = {
  table: string;
  filters: Array<{ column: string; op: string; value: unknown }>;
  update?: Record<string, unknown>;
  deleted: boolean;
};

const queries: LoggedQuery[] = [];
const storageRemovals: string[][] = [];
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
      const entry: LoggedQuery = { table, filters: [], deleted: false };
      queries.push(entry);
      const chain = {
        update: (payload: Record<string, unknown>) => {
          entry.update = payload;
          return chain;
        },
        select: () => chain,
        delete: () => {
          entry.deleted = true;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          entry.filters.push({ column, op: "eq", value });
          return chain;
        },
        maybeSingle: async () => resultFor(table),
        then: (onFulfilled: (value: QueryResult) => unknown) =>
          Promise.resolve(resultFor(table)).then(onFulfilled),
      };
      return chain;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "reset_document_version_for_retry" && state.rpcError !== null) {
        return { data: null, error: state.rpcError };
      }
      void args;
      return { data: [{ document_id: "doc-1", version_id: "ver-1", storage_path: "p" }], error: null };
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          storageRemovals.push(paths);
          return { error: null };
        },
      }),
    },
  }),
}));

import {
  archiveDocumentAction,
  deleteDocumentAction,
  restoreDocumentAction,
  retryIngestAction,
  updateDocumentAction,
  type DocumentActionState,
} from "@/features/documents/actions";

function formDataOf(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

const idle: DocumentActionState = { status: "idle" };

beforeEach(() => {
  queries.length = 0;
  storageRemovals.length = 0;
  state.pipelineCalls.length = 0;
  state.revalidated.length = 0;
  state.rpcError = null;
  tableResults = {
    documents: { data: { id: "doc-1" }, error: null },
    document_versions: { data: { storage_path: "org/doc/ver/a.txt", mime_type: "text/plain", checksum_sha256: "x" }, error: null },
  };
});

describe("updateDocumentAction", () => {
  it("saves metadata scoped to the organization and document", async () => {
    const result = await updateDocumentAction("org", "doc-1", idle, formDataOf({
      title: "Access Control Policy",
      category: "policies",
      tags: "SOC2, Product",
      reviewBy: "2026-12-01",
    }));

    expect(result).toEqual({ status: "success", message: "Saved." });
    const update = queries.find((query) => query.table === "documents" && query.update !== undefined);
    expect(update?.update).toEqual({
      title: "Access Control Policy",
      category: "policies",
      tags: ["soc2", "product"],
      review_by: "2026-12-01",
    });
    const columns = update?.filters.map((filter) => filter.column);
    expect(columns).toContain("id");
    expect(columns).toContain("organization_id");
  });

  it("clears the review date when the field is blank", async () => {
    await updateDocumentAction("org", "doc-1", idle, formDataOf({ title: "Policy", reviewBy: "" }));
    const update = queries.find((query) => query.update !== undefined);
    expect(update?.update).toMatchObject({ title: "Policy", review_by: null });
  });

  it("rejects invalid input without writing", async () => {
    const result = await updateDocumentAction("org", "doc-1", idle, formDataOf({
      title: "x".repeat(201),
    }));
    expect(result.status).toBe("error");
    expect(queries).toHaveLength(0);
  });

  it("treats an empty title as no title change (client marks it required)", async () => {
    const result = await updateDocumentAction("org", "doc-1", idle, formDataOf({ title: "", tags: "soc2" }));
    expect(result).toEqual({ status: "success", message: "Saved." });
    const update = queries.find((query) => query.update !== undefined);
    expect(update?.update).toEqual({ tags: ["soc2"] });
  });

  it("reports an error when the row is not updated (denied or missing)", async () => {
    tableResults = { documents: { data: null, error: null } };
    const result = await updateDocumentAction("org", "doc-1", idle, formDataOf({ title: "Policy" }));
    expect(result.status).toBe("error");
  });
});

describe("archive / restore", () => {
  it("archives scoped to the org and revalidates both surfaces", async () => {
    await archiveDocumentAction("org", formDataOf({ documentId: "doc-1" }));
    const update = queries.find((query) => query.update !== undefined);
    expect(update?.update).toEqual({ state: "archived" });
    expect(update?.filters).toContainEqual({ column: "organization_id", op: "eq", value: "org-1" });
    expect(state.revalidated).toContain("/app/org/documents");
  });

  it("restores to active", async () => {
    await restoreDocumentAction("org", formDataOf({ documentId: "doc-1" }));
    const update = queries.find((query) => query.update !== undefined);
    expect(update?.update).toEqual({ state: "active" });
  });

  it("ignores calls without a document id", async () => {
    await archiveDocumentAction("org", formDataOf({}));
    expect(queries).toHaveLength(0);
  });
});

describe("deleteDocumentAction", () => {
  it("deletes the row and removes the stored objects", async () => {
    tableResults = {
      documents: { data: null, error: null },
      document_versions: { data: [{ storage_path: "org/doc/v1/a.pdf" }, { storage_path: "org/doc/v2/a.pdf" }], error: null },
    };
    await deleteDocumentAction("org", formDataOf({ documentId: "doc-1" }));

    const deleteQuery = queries.find((query) => query.deleted);
    expect(deleteQuery?.table).toBe("documents");
    expect(deleteQuery?.filters).toContainEqual({ column: "organization_id", op: "eq", value: "org-1" });
    expect(storageRemovals).toEqual([["org/doc/v1/a.pdf", "org/doc/v2/a.pdf"]]);
    expect(state.revalidated).toContain("/app/org/documents");
  });

  it("still deletes the row when the storage cleanup fails", async () => {
    tableResults = {
      documents: { data: null, error: null },
      document_versions: { data: null, error: { message: "denied" } },
    };
    await deleteDocumentAction("org", formDataOf({ documentId: "doc-1" }));
    expect(queries.some((query) => query.deleted)).toBe(true);
    expect(storageRemovals).toHaveLength(0);
  });
});

describe("retryIngestAction", () => {
  it("runs the pipeline with the MIME-derived kind after a successful reset", async () => {
    await retryIngestAction("org", "doc-1", formDataOf({ versionId: "ver-1" }));

    expect(state.pipelineCalls).toEqual([
      { kind: "txt", documentId: "doc-1", versionId: "ver-1" },
    ]);
    expect(state.revalidated).toContain("/app/org/documents/doc-1");
  });

  it("maps pdf and markdown MIME types to their parser kinds", async () => {
    tableResults = {
      documents: { data: null, error: null },
      document_versions: {
        data: { storage_path: "p", mime_type: "application/pdf", checksum_sha256: "x" },
        error: null,
      },
    };
    await retryIngestAction("org", "doc-1", formDataOf({ versionId: "ver-1" }));
    expect(state.pipelineCalls[0]?.kind).toBe("pdf");
  });

  it("never starts the pipeline when the retry RPC refuses", async () => {
    state.rpcError = { message: "RETRY_LIMIT_REACHED" };
    await retryIngestAction("org", "doc-1", formDataOf({ versionId: "ver-1" }));
    expect(state.pipelineCalls).toHaveLength(0);
  });

  it("does nothing without a version id", async () => {
    await retryIngestAction("org", "doc-1", formDataOf({}));
    expect(state.pipelineCalls).toHaveLength(0);
  });
});
