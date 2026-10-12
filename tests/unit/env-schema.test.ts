import { describe, expect, it } from "vitest";

import { collectEnvWarnings, envSchema } from "@/lib/validation/env-schema";

/**
 * Minimal valid development input — every optional variable deliberately absent.
 * Helpers under test treat "" as absent, mirroring the blank .env.example keys.
 */
const DEV_ENV = {
  APP_ENV: "development",
} as Record<string, string>;

function parse(input: Record<string, string>) {
  return envSchema.safeParse({ ...DEV_ENV, ...input });
}

/** Variable names present in an error report (names only — values never asserted by key content). */
function errorPaths(result: ReturnType<typeof parse>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("env schema — development defaults", () => {
  it("accepts an empty development environment and applies documented defaults", () => {
    const result = envSchema.safeParse({ APP_ENV: "development" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.APP_ENV).toBe("development");
      expect(result.data.NEXT_PUBLIC_APP_NAME).toBe("QuestCite");
      expect(result.data.DEMO_MODE).toBe(true); // shipped demo default (plan §14)
      expect(result.data.OPENAI_STORE_RESPONSES).toBe(false);
      expect(result.data.AI_MAX_INPUT_TOKENS_PER_RUN).toBe(120_000);
      expect(result.data.DEMO_AI_GLOBAL_DAILY_LIMIT).toBe(20);
      expect(result.data.EMAIL_DELIVERY_MODE).toBe("log");
      expect(result.data.LEMON_SQUEEZY_TEST_MODE).toBe(true);
    }
  });

  it("treats empty-string values as unset", () => {
    const result = parse({
      NEXT_PUBLIC_APP_URL: "",
      OPENAI_API_KEY: "   ",
      PLATFORM_ADMIN_EMAILS: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NEXT_PUBLIC_APP_URL).toBeUndefined();
      expect(result.data.OPENAI_API_KEY).toBeUndefined();
      expect(result.data.PLATFORM_ADMIN_EMAILS).toBeUndefined();
    }
  });

  it("rejects non-boolean strings instead of silently coercing", () => {
    expect(errorPaths(parse({ AI_ENABLED: "yes" }))).toContain("AI_ENABLED");
    expect(errorPaths(parse({ DEMO_MODE: "1" }))).toContain("DEMO_MODE");
  });

  it("rejects malformed numbers", () => {
    expect(errorPaths(parse({ DEMO_AI_GLOBAL_DAILY_LIMIT: "abc" }))).toContain("DEMO_AI_GLOBAL_DAILY_LIMIT");
    expect(errorPaths(parse({ DEMO_AI_GLOBAL_DAILY_LIMIT: "-5" }))).toContain("DEMO_AI_GLOBAL_DAILY_LIMIT");
    expect(errorPaths(parse({ DEMO_AI_GLOBAL_DAILY_LIMIT: "0" }))).toContain("DEMO_AI_GLOBAL_DAILY_LIMIT");
  });

  it("validates admin emails as a comma-separated list", () => {
    expect(errorPaths(parse({ PLATFORM_ADMIN_EMAILS: "ops@example.test" }))).toEqual([]);
    expect(errorPaths(parse({ PLATFORM_ADMIN_EMAILS: "ops@example.test,root@example.test" }))).toEqual([]);
    // Array element failures surface with an index suffix on the parent path.
    expect(errorPaths(parse({ PLATFORM_ADMIN_EMAILS: "not-an-email" }))).toContain("PLATFORM_ADMIN_EMAILS.0");
  });
});

describe("env schema — production gates", () => {
  const VALID_PROD_BASE = {
    APP_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://db.example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-value",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-value",
    OPENAI_API_KEY: "openai-value",
    AUDIT_HASH_SALT: "a".repeat(32),
    EMAIL_DELIVERY_MODE: "resend",
    RESEND_API_KEY: "resend-value",
    EMAIL_FROM: "noreply@example.com",
    DEMO_MODE: "false",
    LEMON_SQUEEZY_TEST_MODE: "false",
    LEMON_SQUEEZY_API_KEY: "ls-value",
    LEMON_SQUEEZY_STORE_ID: "store",
    LEMON_SQUEEZY_WEBHOOK_SECRET: "whsec-value",
  } as Record<string, string>;

  function parseProd(overrides: Record<string, string>) {
    return envSchema.safeParse({ ...VALID_PROD_BASE, ...overrides });
  }

  function prodErrorPaths(overrides: Record<string, string>): string[] {
    const result = parseProd(overrides);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
  }

  it("accepts a fully-configured production environment", () => {
    const result = parseProd({});
    expect(result.success).toBe(true);
  });

  it("fails when production essentials are missing", () => {
    const base = { ...VALID_PROD_BASE };
    const required = [
      "NEXT_PUBLIC_APP_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "AUDIT_HASH_SALT",
    ] as const;
    for (const key of required) {
      const without = { ...base };
      delete without[key];
      const result = envSchema.safeParse(without);
      expect(result.success === false && errorPaths(result).includes(key), `expected ${key} to be required`).toBe(true);
    }
  });

  it("requires https:// for NEXT_PUBLIC_APP_URL in production", () => {
    expect(prodErrorPaths({ NEXT_PUBLIC_APP_URL: "http://app.example.com" })).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("requires a 32+ character AUDIT_HASH_SALT in production", () => {
    expect(prodErrorPaths({ AUDIT_HASH_SALT: "too-short" })).toContain("AUDIT_HASH_SALT");
  });

  it("fails production when the email mode would silently drop user email", () => {
    expect(prodErrorPaths({ EMAIL_DELIVERY_MODE: "log" })).toContain("EMAIL_DELIVERY_MODE");
  });

  it("allows log email mode in production only for the public demo deployment", () => {
    const result = parseProd({ EMAIL_DELIVERY_MODE: "log", DEMO_MODE: "true" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(collectEnvWarnings(result.data).join("\n")).toMatch(/DEMO_MODE/);
    }
  });

  it("blocks dangerous demo mutation bypasses in production (plan §15)", () => {
    expect(prodErrorPaths({ DEMO_UPLOADS_ENABLED: "true" })).toContain("DEMO_UPLOADS_ENABLED");
    expect(prodErrorPaths({ DEMO_EMAILS_ENABLED: "true" })).toContain("DEMO_EMAILS_ENABLED");
  });

  it("requires an OpenAI key when AI is enabled in production", () => {
    const withoutKey = { ...VALID_PROD_BASE };
    delete withoutKey.OPENAI_API_KEY;
    const result = envSchema.safeParse(withoutKey);
    expect(result.success === false && errorPaths(result).includes("OPENAI_API_KEY")).toBe(true);
  });

  it("rejects live demo AI outside demo mode or without a key", () => {
    expect(prodErrorPaths({ LIVE_DEMO_AI_ENABLED: "true", DEMO_MODE: "false" })).toContain("LIVE_DEMO_AI_ENABLED");
    const withKey = { ...VALID_PROD_BASE, LIVE_DEMO_AI_ENABLED: "true", DEMO_MODE: "true", OPENAI_API_KEY: "k" };
    expect(envSchema.safeParse(withKey).success).toBe(true);
  });

  it("rejects test-mode billing in a non-demo production deployment", () => {
    expect(prodErrorPaths({ LEMON_SQUEEZY_TEST_MODE: "true" })).toContain("LEMON_SQUEEZY_TEST_MODE");
  });

  it("requires full billing config when enabling live in-app billing", () => {
    expect(errorPaths(parse({ LEMON_SQUEEZY_TEST_MODE: "false" }))).toEqual([]);
    expect(errorPaths(parse({ LEMON_SQUEEZY_TEST_MODE: "false", LEMON_SQUEEZY_API_KEY: "k" }))).toContain("LEMON_SQUEEZY_WEBHOOK_SECRET");
  });

  it("allows a production demo without in-app billing keys", () => {
    const env = { ...VALID_PROD_BASE };
    env.DEMO_MODE = "true";
    env.EMAIL_DELIVERY_MODE = "log";
    env.LEMON_SQUEEZY_TEST_MODE = "false";
    delete env.LEMON_SQUEEZY_API_KEY;
    delete env.LEMON_SQUEEZY_STORE_ID;
    delete env.LEMON_SQUEEZY_WEBHOOK_SECRET;
    expect(envSchema.safeParse(env).success).toBe(true);
  });

  it("accepts a production demo environment without storefront checkout URLs", () => {
    expect(envSchema.safeParse(VALID_PROD_BASE).success).toBe(true);
  });
});

describe("collectEnvWarnings", () => {
  it("warns when Supabase is not yet configured in development", () => {
    const result = envSchema.parse({ APP_ENV: "development" });
    expect(collectEnvWarnings(result).join("\n")).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("flags DEMO_MODE in production as demo-deployment-only", () => {
    const result = envSchema.parse({
      APP_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://demo.example.com",
      NEXT_PUBLIC_SUPABASE_URL: "https://db.example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-value",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-value",
      OPENAI_API_KEY: "openai-value",
      AUDIT_HASH_SALT: "a".repeat(32),
      EMAIL_DELIVERY_MODE: "log",
      DEMO_MODE: "true",
      LEMON_SQUEEZY_TEST_MODE: "true",
    });
    expect(collectEnvWarnings(result).join("\n")).toMatch(/DEMO_MODE/);
    expect(collectEnvWarnings(result).join("\n")).not.toMatch(/LEMON_CHECKOUT/);
  });
});
