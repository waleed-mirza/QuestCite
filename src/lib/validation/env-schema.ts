import { z } from "zod";


/**
 * Environment schema — the single definition of every variable QuestCite reads.
 *
 * Rules (plan §14 + §15):
 * - Validation output must only ever reference variable NAMES, never values.
 * - Production builds fail when dangerous demo defaults remain enabled.
 * - Empty strings are treated as unset (the .env.example ships blank keys).
 *
 * This module is intentionally free of side effects and `server-only` guards so
 * it can be unit-tested directly (tests/unit/env-schema.test.ts).
 */

export const APP_ENVS = ["development", "test", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const EMAIL_DELIVERY_MODES = ["log", "resend"] as const;
export type EmailDeliveryMode = (typeof EMAIL_DELIVERY_MODES)[number];

/** Treat "" / whitespace-only values as unset; absent stays undefined. */
const emptyAsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    schema.optional(),
  );

/** Strict "true"/"false" — anything else is a configuration error, not a silent default. */
const boolFromString = (defaultValue: boolean) =>
  emptyAsUnset(z.enum(["true", "false"]))
    .default(defaultValue ? "true" : "false")
    .transform((value) => value === "true");

const positiveIntFromString = (defaultValue: number) =>
  emptyAsUnset(
    z
      .string()
      .regex(/^\d+$/, "must be a positive integer")
      .transform(Number)
      .pipe(z.number().int().positive()),
  ).default(defaultValue);

const optionalSecret = emptyAsUnset(z.string().min(1));
const optionalUrl = emptyAsUnset(z.url());
const optionalEmail = emptyAsUnset(z.email());

const emailListFromString = emptyAsUnset(
  z
    .string()
    .transform((value) => value.split(",").map((entry) => entry.trim()).filter(Boolean))
    .pipe(z.array(z.email()).min(1)),
);

/**
 * No secret may ever be exposed under a NEXT_PUBLIC_ name. Static allow-list of
 * the public surface; anything else browser-facing must be reviewed here first.
 */
export const PUBLIC_ENV_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_APP_NAME",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

export const envSchema = z
  .object({
    // App
    NEXT_PUBLIC_APP_URL: optionalUrl,
    NEXT_PUBLIC_APP_NAME: z.string().min(1).default("QuestCite"),
    APP_ENV: z.enum(APP_ENVS).default("development"),

    // Supabase — browser-safe
    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalSecret,

    // Supabase — server only (NEVER referenced from a Client Component)
    SUPABASE_SERVICE_ROLE_KEY: optionalSecret,

    // OpenAI
    OPENAI_API_KEY: optionalSecret,
    OPENAI_ANSWER_MODEL: z.string().min(1).default("gpt-5.6-luna"),
    OPENAI_EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
    OPENAI_STORE_RESPONSES: boolFromString(false),
    AI_ENABLED: boolFromString(true),
    AI_MAX_INPUT_TOKENS_PER_RUN: positiveIntFromString(120_000),
    AI_MAX_OUTPUT_TOKENS_PER_RUN: positiveIntFromString(4_000),

    // Resend
    RESEND_API_KEY: optionalSecret,
    EMAIL_FROM: optionalEmail,
    EMAIL_REPLY_TO: optionalEmail,
    EMAIL_DELIVERY_MODE: z.enum(EMAIL_DELIVERY_MODES).default("log"),

    // Optional workspace subscriptions for a self-hosted copy.
    LEMON_SQUEEZY_API_KEY: optionalSecret,
    LEMON_SQUEEZY_STORE_ID: optionalSecret,
    LEMON_SQUEEZY_WEBHOOK_SECRET: optionalSecret,
    LEMON_SQUEEZY_STARTER_VARIANT_ID: optionalSecret,
    LEMON_SQUEEZY_PRO_VARIANT_ID: optionalSecret,
    LEMON_SQUEEZY_AGENCY_VARIANT_ID: optionalSecret,
    LEMON_SQUEEZY_TEST_MODE: boolFromString(true),

    // Demo protection (plan §15)
    DEMO_MODE: boolFromString(true),
    DEMO_ORG_SLUG: z.string().min(1).default("northstar-cloud"),
    LIVE_DEMO_AI_ENABLED: boolFromString(false),
    DEMO_AI_GLOBAL_DAILY_LIMIT: positiveIntFromString(20),
    DEMO_AI_USER_DAILY_LIMIT: positiveIntFromString(1),
    DEMO_AI_MAX_QUESTIONS: positiveIntFromString(5),
    DEMO_UPLOADS_ENABLED: boolFromString(false),
    DEMO_EMAILS_ENABLED: boolFromString(false),

    // Platform administration
    PLATFORM_ADMIN_EMAILS: emailListFromString,
    AUDIT_HASH_SALT: optionalSecret,
  })
  .superRefine((env, ctx) => {
    const isProduction = env.APP_ENV === "production";
    const requireInProduction = (key: string, present: boolean, message: string) => {
      if (isProduction && !present) {
        ctx.addIssue({ code: "custom", path: [key], message });
      }
    };

    // --- Required in production -------------------------------------------------
    requireInProduction("NEXT_PUBLIC_APP_URL", env.NEXT_PUBLIC_APP_URL !== undefined, "required in production");
    if (isProduction && env.NEXT_PUBLIC_APP_URL !== undefined && !env.NEXT_PUBLIC_APP_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["NEXT_PUBLIC_APP_URL"], message: "must be an https:// URL in production" });
    }
    requireInProduction("NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL !== undefined, "required in production");
    requireInProduction("NEXT_PUBLIC_SUPABASE_ANON_KEY", env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== undefined, "required in production");
    requireInProduction("SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY !== undefined, "required in production");
    if (isProduction && env.AUDIT_HASH_SALT !== undefined && env.AUDIT_HASH_SALT.length < 32) {
      ctx.addIssue({ code: "custom", path: ["AUDIT_HASH_SALT"], message: "must be at least 32 characters" });
    }
    requireInProduction("AUDIT_HASH_SALT", env.AUDIT_HASH_SALT !== undefined, "required in production (min 32 characters)");

    // --- Email -------------------------------------------------------------------
    if (env.EMAIL_DELIVERY_MODE === "resend") {
      if (env.RESEND_API_KEY === undefined) {
        ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "required when EMAIL_DELIVERY_MODE=resend" });
      }
      if (env.EMAIL_FROM === undefined) {
        ctx.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: "required when EMAIL_DELIVERY_MODE=resend" });
      }
    }
    if (isProduction && env.EMAIL_DELIVERY_MODE === "log" && !env.DEMO_MODE) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_DELIVERY_MODE"], message: 'production must use "resend" (log mode silently drops user emails) unless DEMO_MODE=true' });
    }

    // --- AI ----------------------------------------------------------------------
    if (env.AI_ENABLED && isProduction && env.OPENAI_API_KEY === undefined) {
      ctx.addIssue({ code: "custom", path: ["OPENAI_API_KEY"], message: "required in production when AI_ENABLED=true" });
    }
    if (env.LIVE_DEMO_AI_ENABLED) {
      if (!env.DEMO_MODE) {
        ctx.addIssue({ code: "custom", path: ["LIVE_DEMO_AI_ENABLED"], message: "requires DEMO_MODE=true (live demo AI only runs inside the public demo)" });
      }
      if (env.OPENAI_API_KEY === undefined) {
        ctx.addIssue({ code: "custom", path: ["OPENAI_API_KEY"], message: "required when LIVE_DEMO_AI_ENABLED=true" });
      }
    }

    // --- Demo safety (plan §15: production boot fails on mutation bypasses) ------
    if (isProduction && env.DEMO_UPLOADS_ENABLED) {
      ctx.addIssue({ code: "custom", path: ["DEMO_UPLOADS_ENABLED"], message: "must be false in production (public demo mutation bypass)" });
    }
    if (isProduction && env.DEMO_EMAILS_ENABLED) {
      ctx.addIssue({ code: "custom", path: ["DEMO_EMAILS_ENABLED"], message: "must be false in production (public demo mutation bypass)" });
    }

    // --- Billing -----------------------------------------------------------------
    if (isProduction && !env.DEMO_MODE && env.LEMON_SQUEEZY_TEST_MODE) {
      ctx.addIssue({ code: "custom", path: ["LEMON_SQUEEZY_TEST_MODE"], message: 'must be "false" in production (test-mode payments) unless DEMO_MODE=true' });
    }
    if (!env.LEMON_SQUEEZY_TEST_MODE) {
      const inAppBillingConfigured =
        env.LEMON_SQUEEZY_API_KEY !== undefined ||
        env.LEMON_SQUEEZY_STORE_ID !== undefined ||
        env.LEMON_SQUEEZY_WEBHOOK_SECRET !== undefined;
      if (inAppBillingConfigured) {
        for (const key of ["LEMON_SQUEEZY_API_KEY", "LEMON_SQUEEZY_STORE_ID", "LEMON_SQUEEZY_WEBHOOK_SECRET"] as const) {
          if (env[key] === undefined) {
            ctx.addIssue({ code: "custom", path: [key], message: "required when LEMON_SQUEEZY_TEST_MODE=false (live in-app billing)" });
          }
        }
      }
    }

  });

export type Env = z.output<typeof envSchema>;

/**
 * Non-fatal advisories, reported by name only. `DEMO_MODE=true` in production is
 * legitimate ONLY for the public demo deployment — flag it loudly so an
 * operator cannot ship it by accident without seeing why it's on.
 */
export function collectEnvWarnings(env: Env): string[] {
  const warnings: string[] = [];
  if (env.APP_ENV === "production" && env.DEMO_MODE) {
    warnings.push("DEMO_MODE=true in production — allowed only for the public demo deployment; operators must disable it");
  }
  if (env.APP_ENV === "development" && env.NEXT_PUBLIC_SUPABASE_URL === undefined) {
    warnings.push("NEXT_PUBLIC_SUPABASE_URL — Supabase project not configured yet (see docs/setup-supabase.md)");
  }
  if (env.AI_ENABLED && env.OPENAI_API_KEY === undefined && env.APP_ENV !== "production") {
    warnings.push("OPENAI_API_KEY — AI features will fail until configured");
  }
  return warnings;
}
