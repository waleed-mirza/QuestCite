import { afterEach, describe, expect, it, vi } from "vitest";

import { getDemoConfig } from "@/config/demo";
import { getFeatureFlags } from "@/config/feature-flags";
import { getServerEnv, resetServerEnvCache } from "@/lib/env";

/**
 * Config derivation and the server env accessor. getServerEnv parses the real
 * process.env, so each case stubs only the variables it cares about and resets
 * the memoized parse afterwards.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

function stubMinimalDevEnv() {
  vi.stubEnv("APP_ENV", "development");
}

describe("getServerEnv", () => {
  it("parses a development environment with defaults applied", () => {
    stubMinimalDevEnv();
    const env = getServerEnv();
    expect(env.APP_ENV).toBe("development");
    expect(env.NEXT_PUBLIC_APP_NAME).toBe("QuestCite");
    expect(env.AI_ENABLED).toBe(true);
  });

  it("memoizes the parse within a server lifetime", () => {
    stubMinimalDevEnv();
    expect(getServerEnv()).toBe(getServerEnv());
  });

  it("throws an error naming variables only when production config is unsafe", () => {
    vi.stubEnv("APP_ENV", "production");
    // No other production variables set — validation must fail.
    expect(() => getServerEnv()).toThrow(/Invalid environment configuration/);
    expect(() => getServerEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    // The thrown message must never embed values.
    expect(() => getServerEnv()).not.toThrow(/fake|value|sk-/i);
  });
});

describe("getFeatureFlags", () => {
  it("derives flags from the parsed environment", () => {
    stubMinimalDevEnv();
    const flags = getFeatureFlags();
    expect(flags.aiEnabled).toBe(true);
    expect(flags.liveDemoAiEnabled).toBe(false);
    expect(flags.emailDeliveryMode).toBe("log");
    expect(flags.billingConfigured).toBe(false);
  });

  it("reflects billing as configured only with both required values", () => {
    stubMinimalDevEnv();
    vi.stubEnv("LEMON_SQUEEZY_API_KEY", "ls-key");
    resetServerEnvCache(); // cached parse predates the stub
    expect(getFeatureFlags().billingConfigured).toBe(false);
    vi.stubEnv("LEMON_SQUEEZY_STORE_ID", "store-id");
    resetServerEnvCache();
    expect(getFeatureFlags().billingConfigured).toBe(true);
  });
});

describe("getDemoConfig", () => {
  it("mirrors the shipped demo defaults", () => {
    stubMinimalDevEnv();
    const demo = getDemoConfig();
    expect(demo.mode).toBe(true);
    expect(demo.orgSlug).toBe("northstar-cloud");
    expect(demo.aiGlobalDailyLimit).toBe(20);
    expect(demo.aiUserDailyLimit).toBe(1);
    expect(demo.aiMaxQuestions).toBe(5);
    expect(demo.uploadsEnabled).toBe(false);
    expect(demo.emailsEnabled).toBe(false);
  });

  it("reflects explicit overrides", () => {
    stubMinimalDevEnv();
    vi.stubEnv("DEMO_AI_GLOBAL_DAILY_LIMIT", "5");
    vi.stubEnv("DEMO_UPLOADS_ENABLED", "true");
    resetServerEnvCache();
    const demo = getDemoConfig();
    expect(demo.aiGlobalDailyLimit).toBe(5);
    expect(demo.uploadsEnabled).toBe(true);
  });
});
