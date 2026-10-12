import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeAuthClient } from "./supabase-fakes";

const fakeClientHolder: { current: ReturnType<typeof fakeAuthClient> } = {
  current: fakeAuthClient(null),
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => fakeClientHolder.current,
}));

import { getUser, requireUser } from "@/server/auth/session";
import { UnauthorizedError } from "@/server/errors";

describe("session.getUser", () => {
  beforeEach(() => {
    fakeClientHolder.current = fakeAuthClient(null);
  });

  it("returns the verified identity from claims", async () => {
    fakeClientHolder.current = fakeAuthClient({ sub: "user-1", email: "u@example.com" });
    await expect(getUser()).resolves.toEqual({ userId: "user-1", email: "u@example.com" });
  });

  it("returns null when there are no claims", async () => {
    fakeClientHolder.current = fakeAuthClient(null);
    await expect(getUser()).resolves.toBeNull();
  });

  it("returns null when verification errors (fail closed)", async () => {
    fakeClientHolder.current = fakeAuthClient({ sub: "user-1" }, { message: "jwt expired" });
    await expect(getUser()).resolves.toBeNull();
  });

  it("returns null when claims lack a sub", async () => {
    fakeClientHolder.current = fakeAuthClient({ email: "u@example.com" });
    await expect(getUser()).resolves.toBeNull();
  });

  it("requireUser throws UnauthorizedError without a session", async () => {
    fakeClientHolder.current = fakeAuthClient(null);
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("treats an unconfigured client as anonymous (fresh clone / CI builds)", async () => {
    // Module holder swap: make client creation itself throw.
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: async () => {
        throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing)");
      },
    }));
    const { getUser: freshGetUser } = await import("@/server/auth/session");
    await expect(freshGetUser()).resolves.toBeNull();
    vi.doUnmock("@/lib/supabase/server");
  });
});
