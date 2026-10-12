import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeTableClient, type FakeResult } from "./supabase-fakes";

const fakeClientHolder: { current: ReturnType<typeof fakeTableClient> } = {
  current: fakeTableClient([]),
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => fakeClientHolder.current,
}));

vi.mock("@/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/session")>();
  return {
    ...actual,
    requireUser: async () => ({ userId: "user-1", email: "u@example.com" }),
  };
});

import { ALL_ROLES, requireOrgRole } from "@/server/authorization/org";
import { ForbiddenError, NotFoundError } from "@/server/errors";

const activeOrg: FakeResult = {
  data: { id: "org-1", name: "Org One", slug: "org-one", status: "active" },
  error: null,
};

function membershipRow(role: string): FakeResult {
  return { data: { role }, error: null };
}

describe("requireOrgRole", () => {
  beforeEach(() => {
    fakeClientHolder.current = fakeTableClient([]);
  });

  it("returns organization and role for a permitted member", async () => {
    fakeClientHolder.current = fakeTableClient([activeOrg, membershipRow("owner")]);
    const ctx = await requireOrgRole(["owner"], "org-one");
    expect(ctx.organization).toEqual({ id: "org-1", name: "Org One", slug: "org-one" });
    expect(ctx.role).toBe("owner");
    expect(fakeClientHolder.current.tablesQueried).toEqual(["organizations", "organization_members"]);
  });

  it("throws NotFoundError when the org is invisible (non-member or absent)", async () => {
    fakeClientHolder.current = fakeTableClient([{ data: null, error: null }]);
    await expect(requireOrgRole(ALL_ROLES, "nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws NotFoundError when the org is deactivated (fail closed)", async () => {
    fakeClientHolder.current = fakeTableClient([
      { data: { id: "org-1", name: "O", slug: "o", status: "deactivated" }, error: null },
      membershipRow("owner"),
    ]);
    await expect(requireOrgRole(ALL_ROLES, "o")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws NotFoundError on lookup errors (never leaks cause)", async () => {
    fakeClientHolder.current = fakeTableClient([{ data: null, error: { message: "boom" } }]);
    await expect(requireOrgRole(ALL_ROLES, "x")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws NotFoundError when membership row is missing", async () => {
    fakeClientHolder.current = fakeTableClient([activeOrg, { data: null, error: null }]);
    await expect(requireOrgRole(ALL_ROLES, "org-one")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError when the role is not allowed", async () => {
    fakeClientHolder.current = fakeTableClient([activeOrg, membershipRow("viewer")]);
    await expect(requireOrgRole(["owner", "admin"], "org-one")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("treats a membership lookup error as not-found (fail closed)", async () => {
    fakeClientHolder.current = fakeTableClient([activeOrg, { data: null, error: { message: "boom" } }]);
    await expect(requireOrgRole(ALL_ROLES, "org-one")).rejects.toBeInstanceOf(NotFoundError);
  });
});
