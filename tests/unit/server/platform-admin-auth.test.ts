import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { userId: string; email: string } | null,
  allowedEmails: ["admin@example.com"] as string[] | undefined,
  invalidEnv: false,
}));

vi.mock("@/server/auth/session", () => ({ getUser: () => Promise.resolve(state.user) }));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => {
    if (state.invalidEnv) throw new Error("invalid environment");
    return { PLATFORM_ADMIN_EMAILS: state.allowedEmails };
  },
}));

import { getPlatformAdmin, requirePlatformAdmin } from "@/server/authorization/platform-admin";

beforeEach(() => {
  state.user = { userId: "user-1", email: "admin@example.com" };
  state.allowedEmails = ["admin@example.com"];
  state.invalidEnv = false;
});
describe("platform admin authorization", () => {
  it("returns the verified allowlisted identity", async () => {
    await expect(getPlatformAdmin()).resolves.toEqual(state.user);
    await expect(requirePlatformAdmin()).resolves.toEqual(state.user);
  });

  it("denies missing, non-allowlisted, and invalidly configured identities", async () => {
    state.user = null;
    await expect(getPlatformAdmin()).resolves.toBeNull();
    await expect(requirePlatformAdmin()).rejects.toThrow("UNAUTHENTICATED");

    state.user = { userId: "user-2", email: "other@example.com" };
    await expect(getPlatformAdmin()).resolves.toBeNull();
    await expect(requirePlatformAdmin()).rejects.toThrow("FORBIDDEN");

    state.invalidEnv = true;
    await expect(getPlatformAdmin()).resolves.toBeNull();
    await expect(requirePlatformAdmin()).rejects.toThrow("FORBIDDEN");
  });
});
