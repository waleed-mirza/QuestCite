/**
 * Knowledge entry actions: create/edit goes through save_knowledge_entry
 * (entry + immutable version in one transaction), delete is org-scoped.
 * Validation failures must never reach the database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  ctx: { organization: { id: string; name: string; slug: string }; role: "owner" | "admin" };
  rpcError: { message: string } | null;
  rpcResult: unknown;
} = {
  ctx: { organization: { id: "org-1", name: "Org", slug: "org" }, role: "owner" },
  rpcError: null,
  rpcResult: "entry-1",
};

vi.mock("@/server/authorization/org", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/authorization/org")>();
  return {
    ...actual,
    requireOrgRole: async () => state.ctx,
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

type LoggedQuery = {
  table: string;
  filters: Array<{ column: string; op: string; value: unknown }>;
  deleted: boolean;
};

const queries: LoggedQuery[] = [];
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const entry: LoggedQuery = { table, filters: [], deleted: false };
      queries.push(entry);
      const chain = {
        delete: () => {
          entry.deleted = true;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          entry.filters.push({ column, op: "eq", value });
          return chain;
        },
        then: (onFulfilled: (value: { data: unknown; error: unknown }) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(onFulfilled),
      };
      return chain;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (state.rpcError !== null) {
        return { data: null, error: state.rpcError };
      }
      return { data: state.rpcResult, error: null };
    },
  }),
}));

import {
  deleteKnowledgeEntryAction,
  saveKnowledgeEntryAction,
  type EntryActionState,
} from "@/features/knowledge/actions";

function formDataOf(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

const idle: EntryActionState = { status: "idle" };

beforeEach(() => {
  queries.length = 0;
  rpcCalls.length = 0;
  state.rpcError = null;
  state.rpcResult = "entry-1";
});

describe("saveKnowledgeEntryAction", () => {
  it("creates an entry through the RPC with parsed tags and no entry id", async () => {
    const result = await saveKnowledgeEntryAction("org", idle, formDataOf({
      question: "Is data encrypted at rest?",
      answer: "Yes, AES-256.",
      category: "security",
      tagsText: "SOC2, Product",
      reviewState: "approved",
      entryId: "",
    }));

    expect(result).toEqual({ status: "success", entryId: "entry-1", message: "Entry created." });
    expect(rpcCalls[0]?.name).toBe("save_knowledge_entry");
    expect(rpcCalls[0]?.args).toMatchObject({
      p_organization_id: "org-1",
      p_question: "Is data encrypted at rest?",
      p_category: "security",
      p_tags: ["soc2", "product"],
      p_review_state: "approved",
      p_entry_id: null,
    });
  });

  it("passes the entry id on edits so a new version is appended", async () => {
    const entryId = "11111111-1111-4111-8111-111111111111";
    const result = await saveKnowledgeEntryAction("org", idle, formDataOf({
      question: "Updated question?",
      answer: "Updated answer.",
      category: "security",
      tagsText: "",
      reviewState: "approved",
      entryId,
    }));

    expect(result).toEqual({ status: "success", entryId: "entry-1", message: "Entry saved as a new version." });
    expect(rpcCalls[0]?.args.p_entry_id).toBe(entryId);
  });

  it("rejects a missing answer before touching the database", async () => {
    const result = await saveKnowledgeEntryAction("org", idle, formDataOf({
      question: "Is data encrypted at rest?",
      reviewState: "draft",
    }));

    expect(result.status).toBe("error");
    expect(rpcCalls).toHaveLength(0);
  });

  it("rejects more than 20 tags", async () => {
    const result = await saveKnowledgeEntryAction("org", idle, formDataOf({
      question: "Q?",
      answer: "A.",
      category: "general",
      tagsText: Array.from({ length: 21 }, (_, index) => `tag${index}`).join(", "),
      reviewState: "draft",
    }));

    expect(result.status).toBe("error");
    expect(rpcCalls).toHaveLength(0);
  });

  it("surfaces an RPC refusal as a safe error", async () => {
    state.rpcError = { message: "ENTRY_INPUT_INVALID" };
    const result = await saveKnowledgeEntryAction("org", idle, formDataOf({
      question: "Q?",
      answer: "A.",
      category: "general",
      reviewState: "draft",
    }));

    expect(result.status).toBe("error");
  });
});

describe("deleteKnowledgeEntryAction", () => {
  it("deletes scoped to the organization", async () => {
    await deleteKnowledgeEntryAction("org", formDataOf({ entryId: "entry-1" }));

    const deleteQuery = queries.find((query) => query.deleted);
    expect(deleteQuery?.table).toBe("knowledge_entries");
    expect(deleteQuery?.filters).toContainEqual({ column: "id", op: "eq", value: "entry-1" });
    expect(deleteQuery?.filters).toContainEqual({ column: "organization_id", op: "eq", value: "org-1" });
  });

  it("ignores calls without an entry id", async () => {
    await deleteKnowledgeEntryAction("org", formDataOf({}));
    expect(queries).toHaveLength(0);
  });
});
