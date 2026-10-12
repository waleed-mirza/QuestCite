/**
 * createOrganizationAction: validation, RPC error-code mapping to safe
 * messages, and the success redirect into the new workspace.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { rpcError: { message: string } | null } = { rpcError: null };
const redirects: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: async () => ({ data: state.rpcError === null ? "org-1" : null, error: state.rpcError }),
  }),
}));

vi.mock("@/server/auth/session", () => ({
  requireUser: async () => ({ userId: "u1", email: "u@example.com" }),
}));

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    redirects.push(target);
    throw new Error(`NEXT_REDIRECT:${target}`);
  },
}));

import { createOrganizationAction } from "@/features/onboarding/actions";

function formDataOf(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

const idle = { status: "idle" } as const;
const valid = { name: "Acme Robotics", slug: "acme-robotics" };

beforeEach(() => {
  state.rpcError = null;
  redirects.length = 0;
});

describe("createOrganizationAction", () => {
  it("returns field errors for invalid slugs without calling the RPC", async () => {
    const result = await createOrganizationAction(idle, formDataOf({ name: "Acme", slug: "demo" }));
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.fields?.slug !== undefined).toBe(true);
  });

  it("redirects into the workspace on success", async () => {
    await expect(createOrganizationAction(idle, formDataOf(valid))).rejects.toThrow(
      "NEXT_REDIRECT:/app/acme-robotics",
    );
  });

  it("maps SLUG_TAKEN to a safe message", async () => {
    state.rpcError = { message: "SLUG_TAKEN" };
    const result = await createOrganizationAction(idle, formDataOf(valid));
    expect(result.status === "error" && result.message.includes("already taken")).toBe(true);
  });

  it("maps SLUG_RESERVED to a safe message", async () => {
    state.rpcError = { message: "SLUG_RESERVED" };
    const result = await createOrganizationAction(idle, formDataOf(valid));
    expect(result.status === "error" && result.message.includes("reserved")).toBe(true);
  });

  it("maps the slug CHECK backstop without echoing provider text", async () => {
    state.rpcError = {
      message: 'new row for relation "organizations" violates check constraint "organizations_slug_check"',
    };
    const result = await createOrganizationAction(idle, formDataOf(valid));
    expect(result.status === "error" && result.message === "Check the workspace name and address.").toBe(true);
  });

  it("falls back to a generic message for unknown failures", async () => {
    state.rpcError = { message: "connection reset" };
    const result = await createOrganizationAction(idle, formDataOf(valid));
    expect(result.status === "error" && result.message.startsWith("We couldn't create")).toBe(true);
  });
});
