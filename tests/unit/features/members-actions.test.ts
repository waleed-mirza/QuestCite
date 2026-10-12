/**
 * inviteMemberAction surface: guard failure, duplicate-invite mapping, and the
 * one-time success payload shape (never exposes the stored hash).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  ctx: { organization: { id: string; name: string; slug: string }; role: "owner" };
  insertError: { code?: string; message: string } | null;
} = {
  ctx: { organization: { id: "org-1", name: "Org", slug: "org" }, role: "owner" },
  insertError: null,
};

vi.mock("@/server/authorization/org", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/authorization/org")>();
  return {
    ...actual,
    requireOrgRole: async () => state.ctx,
  };
});

vi.mock("@/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/session")>();
  return {
    ...actual,
    requireUser: async () => ({ userId: "u1", email: "owner@example.com" }),
  };
});

vi.mock("@/features/members/server", () => ({
  generateInviteToken: () => ({ token: "raw-token-0000000000000001", tokenHash: "a".repeat(64) }),
}));

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn().mockResolvedValue("logged") }));
vi.mock("@/lib/email/send", () => ({ sendEmail }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const insertResult = async (): Promise<{ data: unknown; error: unknown }> => {
        if (table === "organization_invites") {
          return { data: state.insertError === null ? { id: "inv-1" } : null, error: state.insertError };
        }
        return { data: null, error: null };
      };
      return {
        insert: () => {
          const pending = insertResult();
          return Object.assign(pending, {
            select: () => ({
              single: async () => pending,
            }),
          });
        },
      };
    },
  }),
}));

import { inviteMemberAction } from "@/features/members/actions";

function formDataOf(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

const idle = null;

beforeEach(() => {
  state.insertError = null;
  sendEmail.mockClear();
});

describe("inviteMemberAction", () => {
  it("returns an invited payload with the one-time URL", async () => {
    const result = await inviteMemberAction("org", idle, formDataOf({ email: "new@example.com", role: "viewer" }));
    expect(result).toEqual({
      status: "invited",
      email: "new@example.com",
      inviteUrl: "/invite/raw-token-0000000000000001",
    });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: "member.invite",
      toUserId: "inv-1",
      toEmail: "new@example.com",
    }));
  });

  it("maps a duplicate pending invite to a friendly message", async () => {
    state.insertError = { code: "23505", message: "duplicate key value violates unique constraint" };
    const result = await inviteMemberAction("org", idle, formDataOf({ email: "new@example.com", role: "viewer" }));
    expect(result.status === "error" && result.message.includes("already a pending invitation")).toBe(true);
  });

  it("rejects invalid input without touching the database", async () => {
    const result = await inviteMemberAction("org", idle, formDataOf({ email: "nope", role: "owner" }));
    expect(result.status).toBe("error");
  });
});
