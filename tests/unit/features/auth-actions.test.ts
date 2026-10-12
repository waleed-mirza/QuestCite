/**
 * Auth Server Action behavior: validation failures, safe error mapping, and
 * redirect targets. The Supabase server client is faked; provider errors are
 * never surfaced verbatim to the caller (AGENTS.md rule 8).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  authError: { status?: number; message: string } | null;
  signUpResult: { session: unknown } | { session: null };
  signedOut: boolean;
  user: { userId: string; email: string } | null;
} = {
  authError: null,
  signUpResult: { session: null },
  signedOut: false,
  user: null,
};

const redirects: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithPassword: async () => ({ data: {}, error: state.authError }),
      signUp: async () => ({ data: state.signUpResult, error: state.authError }),
      resetPasswordForEmail: async () => ({ data: {}, error: state.authError }),
      updateUser: async () => ({ data: {}, error: state.authError }),
      signOut: async () => {
        state.signedOut = true;
        return { error: null };
      },
    },
  }),
}));

vi.mock("@/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/session")>();
  return {
    ...actual,
    getUser: async () => state.user,
  };
});

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    redirects.push(target);
    throw new Error(`NEXT_REDIRECT:${target}`);
  },
}));

import {
  requestPasswordResetAction,
  resetPasswordAction,
  signInAction,
  signOutAction,
  signUpAction,
} from "@/features/auth/actions";

function formDataOf(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

const idle = { status: "idle" } as const;

async function expectRedirectTo(promise: Promise<unknown>, target: string): Promise<void> {
  await expect(promise).rejects.toThrow(`NEXT_REDIRECT:${target}`);
}

beforeEach(() => {
  state.authError = null;
  state.signUpResult = { session: null };
  state.signedOut = false;
  state.user = null;
  redirects.length = 0;
});

describe("signInAction", () => {
  it("returns field errors for invalid input", async () => {
    const result = await signInAction(idle, formDataOf({ email: "nope", password: "" }));
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.fields?.email !== undefined).toBe(true);
  });

  it("maps bad credentials to a safe message", async () => {
    state.authError = { status: 400, message: "Invalid login credentials" };
    const result = await signInAction(idle, formDataOf({ email: "a@b.co", password: "wrong-pass-1a" }));
    expect(result).toEqual({ status: "error", message: "Invalid email or password." });
  });

  it("maps rate limits to a retry message", async () => {
    state.authError = { status: 429, message: "Too many requests" };
    const result = await signInAction(idle, formDataOf({ email: "a@b.co", password: "whatever1a" }));
    expect(result.status === "error" && result.message.includes("Too many attempts")).toBe(true);
  });

  it("redirects to onboarding on success", async () => {
    await expectRedirectTo(
      signInAction(idle, formDataOf({ email: "a@b.co", password: "Valid-Pass-2026" })),
      "/onboarding",
    );
  });
});

describe("signUpAction", () => {
  const base = { fullName: "Ada", email: "a@b.co", password: "Valid-Pass-2026", confirmPassword: "Valid-Pass-2026" };

  it("rejects mismatched confirmation without calling auth", async () => {
    const result = await signUpAction(idle, formDataOf({ ...base, confirmPassword: "different1a" }));
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.fields?.confirmPassword !== undefined).toBe(true);
  });

  it("routes already-registered emails to the login message", async () => {
    state.authError = { status: 422, message: "User already registered" };
    const result = await signUpAction(idle, formDataOf(base));
    expect(result.status === "error" && result.message.includes("sign in instead")).toBe(true);
  });

  it("shows the check-your-inbox state when confirmation is pending", async () => {
    const result = await signUpAction(idle, formDataOf(base));
    expect(result.status).toBe("success");
  });

  it("continues straight to onboarding if a session came back", async () => {
    state.signUpResult = { session: { access_token: "x" } };
    await expectRedirectTo(signUpAction(idle, formDataOf(base)), "/onboarding");
  });
});

describe("requestPasswordResetAction", () => {
  it("shows the neutral success state even when the provider errors", async () => {
    state.authError = { status: 500, message: "internal" };
    const result = await requestPasswordResetAction(idle, formDataOf({ email: "a@b.co" }));
    // The neutral state must not differ between "account exists" and not.
    expect(result.status).toBe("success");
  });
});

describe("resetPasswordAction", () => {
  const base = { password: "Valid-Pass-2026", confirmPassword: "Valid-Pass-2026" };

  it("bounces to login without a recovery session", async () => {
    await expectRedirectTo(resetPasswordAction(idle, formDataOf(base)), "/login?error=recovery_required");
  });

  it("updates the password with a session present", async () => {
    state.user = { userId: "u1", email: "a@b.co" };
    const result = await resetPasswordAction(idle, formDataOf(base));
    expect(result.status).toBe("success");
  });
});

describe("signOutAction", () => {
  it("signs out and redirects to login", async () => {
    await expectRedirectTo(signOutAction(), "/login");
    expect(state.signedOut).toBe(true);
  });
});
