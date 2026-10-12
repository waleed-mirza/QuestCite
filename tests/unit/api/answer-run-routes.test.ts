import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  availability: "ready" as "ready" | "disabled" | "not_configured",
  rpcError: null as { message: string } | null,
  rpcData: [{ run_id: "run-1", created: true, requested_count: 2, skipped_count: 0 }],
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

vi.mock("@/lib/ai/answer-provider", () => ({
  getAnswerAvailability: () => state.availability,
}));

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ OPENAI_ANSWER_MODEL: "gpt-test", AI_ENABLED: true, OPENAI_API_KEY: "configured" }),
}));

vi.mock("@/server/authorization/org", () => ({
  requireOrgRole: async () => ({
    organization: { id: "org-1", name: "Org", slug: "org" },
    role: "reviewer",
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return { data: state.rpcData, error: state.rpcError };
    },
  }),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/questionnaires/[questionnaireId]/runs/route";

const QUESTIONNAIRE_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  state.availability = "ready";
  state.rpcError = null;
  state.rpcCalls.length = 0;
});

describe("POST /api/questionnaires/:questionnaireId/runs", () => {
  it("rejects malformed JSON contracts before authorization or RPC", async () => {
    const response = await POST(
      requestOf({ orgSlug: "org" }),
      { params: Promise.resolve({ questionnaireId: QUESTIONNAIRE_ID }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: "error", code: "QUESTIONNAIRE_INPUT_INVALID" });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("returns a safe no-configuration state without touching the database", async () => {
    state.availability = "not_configured";
    const response = await POST(
      requestOf({ orgSlug: "org", idempotencyKey: "run-2026-09-03" }),
      { params: Promise.resolve({ questionnaireId: QUESTIONNAIRE_ID }) },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "error", code: "AI_NOT_CONFIGURED" });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("passes a validated idempotency key and returns only the run summary", async () => {
    const response = await POST(
      requestOf({
        orgSlug: "org",
        questionIds: ["22222222-2222-4222-8222-222222222222"],
        idempotencyKey: "run-2026-09-03",
      }),
      { params: Promise.resolve({ questionnaireId: QUESTIONNAIRE_ID }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      runId: "run-1",
      created: true,
      requestedCount: 2,
      skippedCount: 0,
    });
    expect(state.rpcCalls[0]).toEqual({
      name: "start_answer_run",
      args: expect.objectContaining({
        p_organization_id: "org-1",
        p_questionnaire_id: QUESTIONNAIRE_ID,
        p_model: "gpt-test",
        p_prompt_version: "draft-v1",
        p_idempotency_key: "run-2026-09-03",
      }),
    });
  });

  it("maps a database refusal to a safe conflict response", async () => {
    state.rpcError = { message: "RUN_ALREADY_ACTIVE" };
    const response = await POST(
      requestOf({ orgSlug: "org", idempotencyKey: "run-2026-09-03" }),
      { params: Promise.resolve({ questionnaireId: QUESTIONNAIRE_ID }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: "error", code: "RUN_ALREADY_ACTIVE" });
  });
});

function requestOf(value: unknown): Request {
  return new Request("http://localhost/api/questionnaires/run/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
