import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  ctx: { organization: { id: string; name: string; slug: string }; role: "owner" | "admin" | "reviewer" };
  rpcError: { message: string } | null;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  revalidated: string[];
} = {
  ctx: { organization: { id: "org-1", name: "Org", slug: "org" }, role: "owner" },
  rpcError: null,
  rpcCalls: [],
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

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({ data: null, error: null }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (state.rpcError !== null) {
        return { data: null, error: state.rpcError };
      }
      return { data: 3, error: null };
    },
  }),
}));

import {
  bulkReviewAction,
  setQuestionnaireReviewerAction,
  setQuestionnaireStatusAction,
  type FormActionState,
} from "@/features/questionnaires/actions";

function formDataOf(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.append(key, value);
  }
  return data;
}

const idle: FormActionState = { status: "idle" };
const UUID = "0b9c8a44-0000-4000-8000-000000000000";

beforeEach(() => {
  state.rpcError = null;
  state.rpcCalls.length = 0;
  state.revalidated.length = 0;
});

describe("bulkReviewAction", () => {
  it("rejects an unknown review target before touching the database", async () => {
    const result = await bulkReviewAction("org", "qn-1", idle, formDataOf({
      questionIds: UUID,
      reviewTarget: "approved-evil",
    }));
    expect(result).toEqual({ status: "error", message: "That review action isn't valid here." });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("requires at least one selected question", async () => {
    const result = await bulkReviewAction("org", "qn-1", idle, formDataOf({ reviewTarget: "approved" }));
    expect(result).toEqual({ status: "error", message: "Select at least one question first." });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("maps a moved/foreign batch to the nothing-applied copy", async () => {
    state.rpcError = { message: "ANSWER_BULK_STATE_CHANGED" };
    const result = await bulkReviewAction("org", "qn-1", idle, formDataOf({
      questionIds: UUID,
      reviewTarget: "approved",
    }));
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("nothing was applied");
    }
    expect(state.revalidated).toHaveLength(0);
  });

  it("applies a valid batch through the RPC and reports the moved count", async () => {
    const result = await bulkReviewAction("org", "qn-1", idle, formDataOf({
      questionIds: UUID,
      reviewTarget: "approved",
    }));
    expect(result).toEqual({ status: "success", message: "3 answers moved to approved." });
    expect(state.rpcCalls[0]).toMatchObject({
      name: "bulk_set_answer_status",
      args: { p_organization_id: "org-1", p_status: "approved" },
    });
    expect(state.revalidated).toContain("/app/org/questionnaires/qn-1");
  });
});

describe("setQuestionnaireStatusAction", () => {
  it("ignores targets outside the human lifecycle set (exported is export-only)", async () => {
    await setQuestionnaireStatusAction("org", "qn-1", formDataOf({ targetStatus: "exported" }));
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("drives the lifecycle RPC and revalidates the surfaces", async () => {
    await setQuestionnaireStatusAction("org", "qn-1", formDataOf({ targetStatus: "completed" }));
    expect(state.rpcCalls[0]).toMatchObject({
      name: "set_questionnaire_status",
      args: { p_organization_id: "org-1", p_questionnaire_id: "qn-1", p_status: "completed" },
    });
    expect(state.revalidated).toContain("/app/org/questionnaires/qn-1");
    expect(state.revalidated).toContain("/app/org/review");
  });
});

describe("setQuestionnaireReviewerAction", () => {
  it("clears the reviewer with NULL, not an empty string", async () => {
    await setQuestionnaireReviewerAction("org", "qn-1", formDataOf({ reviewerId: "" }));
    expect(state.rpcCalls[0]?.args.p_reviewer_id).toBeNull();
  });

  it("ignores malformed reviewer ids", async () => {
    await setQuestionnaireReviewerAction("org", "qn-1", formDataOf({ reviewerId: "not-a-uuid" }));
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("assigns a valid reviewer through the RPC", async () => {
    await setQuestionnaireReviewerAction("org", "qn-1", formDataOf({ reviewerId: UUID }));
    expect(state.rpcCalls[0]).toMatchObject({
      name: "set_questionnaire_reviewer",
      args: { p_organization_id: "org-1", p_questionnaire_id: "qn-1", p_reviewer_id: UUID },
    });
  });
});
