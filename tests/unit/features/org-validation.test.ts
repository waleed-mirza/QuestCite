import { describe, expect, it } from "vitest";

import { createOrganizationSchema, deriveSlug } from "@/lib/validation/org";

describe("deriveSlug", () => {
  it("derives a clean slug from a company name", () => {
    expect(deriveSlug("Acme Robotics")).toBe("acme-robotics");
  });

  it("collapses punctuation and repeated separators", () => {
    expect(deriveSlug("Acme -- Robotics & Co.!")).toBe("acme-robotics-co");
  });

  it("strips leading/trailing hyphens", () => {
    expect(deriveSlug("--Acme--")).toBe("acme");
  });

  it("caps at 40 characters", () => {
    expect(deriveSlug("a".repeat(60)).length).toBe(40);
  });

  it("lowercases everything", () => {
    expect(deriveSlug("Acme ROBOTICS")).toBe("acme-robotics");
  });
});

describe("createOrganizationSchema", () => {
  it("accepts a valid name and slug", () => {
    expect(createOrganizationSchema.safeParse({ name: "Acme", slug: "acme" }).success).toBe(true);
  });

  it("rejects reserved slugs", () => {
    const result = createOrganizationSchema.safeParse({ name: "Demo Inc", slug: "demo" });
    expect(result.success).toBe(false);
  });

  it("rejects slugs that are too short", () => {
    expect(createOrganizationSchema.safeParse({ name: "Ab", slug: "ab" }).success).toBe(false);
  });

  it("rejects leading/trailing hyphens and bad characters", () => {
    expect(createOrganizationSchema.safeParse({ name: "X", slug: "-abc" }).success).toBe(false);
    expect(createOrganizationSchema.safeParse({ name: "X", slug: "abc-" }).success).toBe(false);
    expect(createOrganizationSchema.safeParse({ name: "X", slug: "ab_c" }).success).toBe(false);
  });

  it("rejects empty names", () => {
    expect(createOrganizationSchema.safeParse({ name: "", slug: "acme" }).success).toBe(false);
  });
});
