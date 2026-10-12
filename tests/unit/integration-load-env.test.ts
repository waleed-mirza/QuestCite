import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("hosted integration environment guard", () => {
  it("does not cache a failed production guard", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("ALLOW_HOSTED_TEST_MUTATIONS", "false");

    const { loadIntegrationEnv } = await import("../../tests/integration/helpers/load-env");

    expect(() => loadIntegrationEnv()).toThrow("HOSTED_TESTS_BLOCKED_IN_PRODUCTION");
    expect(() => loadIntegrationEnv()).toThrow("HOSTED_TESTS_BLOCKED_IN_PRODUCTION");
  });
});
