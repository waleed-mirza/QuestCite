import { describe, expect, it } from "vitest";

import { deletionConfirmationSchema, workspaceSettingsSchema } from "@/lib/validation/settings";
import { paidPlanSchema } from "@/lib/validation/billing";

describe("workspace settings validation", () => {
  it("accepts only configured paid plan codes", () => {
    expect(paidPlanSchema.safeParse("starter").success).toBe(true);
    expect(paidPlanSchema.safeParse("trial").success).toBe(false);
  });

  it("accepts form values and normalizes the checkbox", () => {
    expect(workspaceSettingsSchema.parse({ retentionDays: "730", aiDraftsDisabled: "on" })).toEqual({
      retentionDays: 730,
      aiDraftsDisabled: true,
    });
    expect(workspaceSettingsSchema.parse({ retentionDays: 365, aiDraftsDisabled: false })).toEqual({
      retentionDays: 365,
      aiDraftsDisabled: false,
    });
  });

  it("rejects retention outside the database contract and unknown checkbox values", () => {
    expect(workspaceSettingsSchema.safeParse({ retentionDays: "29", aiDraftsDisabled: false }).success).toBe(false);
    expect(workspaceSettingsSchema.safeParse({ retentionDays: "3651", aiDraftsDisabled: false }).success).toBe(false);
    expect(workspaceSettingsSchema.safeParse({ retentionDays: "365", aiDraftsDisabled: "yes" }).success).toBe(false);
  });

  it("requires a bounded exact-match deletion confirmation", () => {
    expect(deletionConfirmationSchema.safeParse("acme-cloud").success).toBe(true);
    expect(deletionConfirmationSchema.safeParse("").success).toBe(false);
    expect(deletionConfirmationSchema.safeParse("x".repeat(121)).success).toBe(false);
  });
});
