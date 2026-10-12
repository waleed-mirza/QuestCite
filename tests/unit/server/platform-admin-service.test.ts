import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  organizations: { data: [] as unknown[], error: null as { message: string } | null },
  subscriptions: { data: [] as unknown[], error: null as { message: string } | null },
  runs: { data: [] as unknown[], error: null as { message: string } | null },
  unavailable: false,
}));

function queryFor(result: { data: unknown[]; error: { message: string } | null }) {
  const promise = Promise.resolve(result);
  const chain = {
    select: () => chain,
    order: () => chain,
    limit: () => chain,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    if (state.unavailable) throw new Error("SERVICE_CLIENT_UNCONFIGURED");
    return {
      from: (table: string) => {
        if (table === "organizations") return queryFor(state.organizations);
        if (table === "subscriptions") return queryFor(state.subscriptions);
        return queryFor(state.runs);
      },
    };
  },
}));
vi.mock("@/lib/observability/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getPlatformOrgHealth } from "@/server/services/platform-admin";

beforeEach(() => {
  state.unavailable = false;
  state.organizations = {
    data: [{ id: "00000000-0000-4000-8000-000000000001", name: "Acme", slug: "acme", status: "active", updated_at: "2026-09-04T00:00:00Z" }],
    error: null,
  };
  state.subscriptions = {
    data: [{ organization_id: "00000000-0000-4000-8000-000000000001", plan_code: "starter", status: "active", renews_at: "2026-10-04T00:00:00Z", ends_at: null }],
    error: null,
  };
  state.runs = {
    data: [
      { organization_id: "00000000-0000-4000-8000-000000000001", status: "running" },
      { organization_id: "00000000-0000-4000-8000-000000000001", status: "failed" },
      { organization_id: "00000000-0000-4000-8000-000000000001", status: "completed" },
      { organization_id: "00000000-0000-4000-8000-000000000001", status: "pending" },
      { organization_id: "00000000-0000-4000-8000-000000000001", status: "cancelled" },
    ],
    error: null,
  };
});
describe("platform health read model", () => {
  it("returns organization/subscription/job aggregates without content fields", async () => {
    await expect(getPlatformOrgHealth()).resolves.toEqual([{
      organizationId: "00000000-0000-4000-8000-000000000001",
      organizationName: "Acme",
      slug: "acme",
      status: "active",
      updatedAt: "2026-09-04T00:00:00Z",
      planCode: "starter",
      subscriptionStatus: "active",
      renewsAt: "2026-10-04T00:00:00Z",
      endsAt: null,
      jobs: { pending: 1, running: 1, completed: 1, failed: 1, other: 1 },
    }]);
  });

  it("returns an empty plan/subscription view for an organization without a subscription", async () => {
    state.subscriptions.data = [];
    state.runs.data = [];
    await expect(getPlatformOrgHealth()).resolves.toMatchObject([{ planCode: "trial", subscriptionStatus: "none" }]);
  });

  it("fails closed for query errors, malformed rows, and unavailable service access", async () => {
    state.organizations.error = { message: "internal details" };
    await expect(getPlatformOrgHealth()).resolves.toBeNull();
    state.organizations.error = null;
    state.organizations.data = [{ id: "not-a-uuid", name: "Acme", slug: "acme", status: "active", updated_at: "now" }];
    await expect(getPlatformOrgHealth()).resolves.toBeNull();
    state.unavailable = true;
    await expect(getPlatformOrgHealth()).resolves.toBeNull();
  });
});
