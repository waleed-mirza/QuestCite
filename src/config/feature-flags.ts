import "server-only";

import { getServerEnv } from "@/lib/env";

/**
 * Server-side feature flags derived from validated env. Client Components never
 * import this module; anything user-facing derives flags from server-rendered
 * props instead (keeps the flag surface intentional and auditable).
 */

export interface FeatureFlags {
  readonly aiEnabled: boolean;
  readonly liveDemoAiEnabled: boolean;
  readonly demoUploadsEnabled: boolean;
  readonly demoEmailsEnabled: boolean;
  readonly emailDeliveryMode: "log" | "resend";
  readonly billingConfigured: boolean;
}

export function getFeatureFlags(): FeatureFlags {
  const env = getServerEnv();
  return {
    aiEnabled: env.AI_ENABLED,
    liveDemoAiEnabled: env.LIVE_DEMO_AI_ENABLED,
    demoUploadsEnabled: env.DEMO_UPLOADS_ENABLED,
    demoEmailsEnabled: env.DEMO_EMAILS_ENABLED,
    emailDeliveryMode: env.EMAIL_DELIVERY_MODE,
    billingConfigured: env.LEMON_SQUEEZY_API_KEY !== undefined && env.LEMON_SQUEEZY_STORE_ID !== undefined,
  };
}
