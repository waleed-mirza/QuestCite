/**
 * Client-safe billing catalog (plan §12 / Week 8).
 *
 * This is the display/configuration mirror of `public.plan_entitlements`.
 * The database remains authoritative for enforcement; keeping the same values
 * here lets the billing page render without exposing server configuration.
 */

export const BILLING_PLAN_CODES = ["free", "trial", "starter", "pro", "agency"] as const;
export type BillingPlanCode = (typeof BILLING_PLAN_CODES)[number];

export const PAID_PLAN_CODES = ["starter", "pro", "agency"] as const;
export type PaidPlanCode = (typeof PAID_PLAN_CODES)[number];

export type PlanDefinition = {
  readonly code: BillingPlanCode;
  readonly name: string;
  readonly description: string;
  readonly period: "month";
  /** -1 is reserved for a future unlimited entitlement. */
  readonly monthlyAiDrafts: number;
  readonly monthlyQuestionnaires: number;
  readonly maxDocuments: number;
  readonly maxMembers: number;
  readonly providerVariantEnv?:
    | "LEMON_SQUEEZY_STARTER_VARIANT_ID"
    | "LEMON_SQUEEZY_PRO_VARIANT_ID"
    | "LEMON_SQUEEZY_AGENCY_VARIANT_ID";
};

export const plans: Record<BillingPlanCode, PlanDefinition> = {
  free: {
    code: "free",
    name: "Free",
    description: "A safe fallback with metadata-only access and no paid AI entitlement.",
    period: "month",
    monthlyAiDrafts: 0,
    monthlyQuestionnaires: 1,
    maxDocuments: 3,
    maxMembers: 3,
  },
  trial: {
    code: "trial",
    name: "Trial",
    description: "Explore the complete workflow with a monthly drafting allowance.",
    period: "month",
    monthlyAiDrafts: 25,
    monthlyQuestionnaires: 1,
    maxDocuments: 5,
    maxMembers: 3,
  },
  starter: {
    code: "starter",
    name: "Starter",
    description: "For a small security team answering questionnaires every month.",
    period: "month",
    monthlyAiDrafts: 250,
    monthlyQuestionnaires: 10,
    maxDocuments: 25,
    maxMembers: 10,
    providerVariantEnv: "LEMON_SQUEEZY_STARTER_VARIANT_ID",
  },
  pro: {
    code: "pro",
    name: "Pro",
    description: "More drafting capacity and workspace room for a growing team.",
    period: "month",
    monthlyAiDrafts: 1500,
    monthlyQuestionnaires: 50,
    maxDocuments: 100,
    maxMembers: 50,
    providerVariantEnv: "LEMON_SQUEEZY_PRO_VARIANT_ID",
  },
  agency: {
    code: "agency",
    name: "Agency",
    description: "High-capacity limits for teams operating across many customers.",
    period: "month",
    monthlyAiDrafts: 5000,
    monthlyQuestionnaires: 200,
    maxDocuments: 500,
    maxMembers: 200,
    providerVariantEnv: "LEMON_SQUEEZY_AGENCY_VARIANT_ID",
  },
};

export function getPlanDefinition(value: string): PlanDefinition | undefined {
  const code = BILLING_PLAN_CODES.find((candidate) => candidate === value);
  return code === undefined ? undefined : plans[code];
}

export function isPaidPlanCode(value: string): value is PaidPlanCode {
  return PAID_PLAN_CODES.find((candidate) => candidate === value) !== undefined;
}
