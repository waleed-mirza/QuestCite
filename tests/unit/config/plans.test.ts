import { describe, expect, it } from "vitest";

import {
  BILLING_PLAN_CODES,
  PAID_PLAN_CODES,
  getPlanDefinition,
  plans,
} from "@/config/plans";

describe("billing plan catalog", () => {
  it("keeps the free fallback at zero paid AI entitlement", () => {
    expect(plans.free.monthlyAiDrafts).toBe(0);
    expect(plans.free.monthlyQuestionnaires).toBe(1);
    expect(plans.free.maxMembers).toBe(3);
  });

  it("keeps the trial contract monthly and bounded", () => {
    expect(plans.trial.monthlyAiDrafts).toBe(25);
    expect(plans.trial.monthlyQuestionnaires).toBe(1);
    expect(plans.trial.period).toBe("month");
  });

  it("exposes only configured paid plans for checkout", () => {
    expect(BILLING_PLAN_CODES).toEqual(["free", "trial", "starter", "pro", "agency"]);
    expect(PAID_PLAN_CODES).toEqual(["starter", "pro", "agency"]);
    expect(getPlanDefinition("starter")?.providerVariantEnv).toBe("LEMON_SQUEEZY_STARTER_VARIANT_ID");
    expect(getPlanDefinition("not-a-plan")).toBeUndefined();
  });
});
