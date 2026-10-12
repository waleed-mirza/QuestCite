import "server-only";

import { getServerEnv } from "@/lib/env";

/**
 * Public-demo guard rails (plan §15). These limits are enforced again in
 * PostgreSQL (atomic rate limiting) — this typed config is the application-side
 * mirror, not the only line of defense.
 */

export interface DemoConfig {
  readonly mode: boolean;
  readonly orgSlug: string;
  readonly liveAiEnabled: boolean;
  readonly aiGlobalDailyLimit: number;
  readonly aiUserDailyLimit: number;
  readonly aiMaxQuestions: number;
  readonly uploadsEnabled: boolean;
  readonly emailsEnabled: boolean;
}

export function getDemoConfig(): DemoConfig {
  const env = getServerEnv();
  return {
    mode: env.DEMO_MODE,
    orgSlug: env.DEMO_ORG_SLUG,
    liveAiEnabled: env.LIVE_DEMO_AI_ENABLED,
    aiGlobalDailyLimit: env.DEMO_AI_GLOBAL_DAILY_LIMIT,
    aiUserDailyLimit: env.DEMO_AI_USER_DAILY_LIMIT,
    aiMaxQuestions: env.DEMO_AI_MAX_QUESTIONS,
    uploadsEnabled: env.DEMO_UPLOADS_ENABLED,
    emailsEnabled: env.DEMO_EMAILS_ENABLED,
  };
}
