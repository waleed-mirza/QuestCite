import { describe, expect, it } from "vitest";

import { assertProtectedOperationAllowed } from "@/lib/operations/production-guard";

describe("production operation guard", () => {
  it("allows protected operations outside production", () => {
    expect(() => assertProtectedOperationAllowed("hosted-tests", { APP_ENV: "development" })).not.toThrow();
    expect(() => assertProtectedOperationAllowed("demo-seed", { APP_ENV: "test" })).not.toThrow();
  });

  it("blocks hosted fixture tests in production without an explicit override", () => {
    expect(() => assertProtectedOperationAllowed("hosted-tests", { APP_ENV: "production" })).toThrow(
      "HOSTED_TESTS_BLOCKED_IN_PRODUCTION",
    );
  });

  it("blocks production demo seeding without an explicit override", () => {
    expect(() => assertProtectedOperationAllowed("demo-seed", { APP_ENV: "production" })).toThrow(
      "DEMO_SEED_BLOCKED_IN_PRODUCTION",
    );
  });

  it("accepts only the explicit true override", () => {
    expect(() =>
      assertProtectedOperationAllowed("hosted-tests", {
        APP_ENV: "production",
        ALLOW_HOSTED_TEST_MUTATIONS: "true",
      }),
    ).not.toThrow();
    expect(() =>
      assertProtectedOperationAllowed("demo-seed", {
        APP_ENV: "production",
        ALLOW_DEMO_SEED_IN_PRODUCTION: "true",
      }),
    ).not.toThrow();
  });
});
