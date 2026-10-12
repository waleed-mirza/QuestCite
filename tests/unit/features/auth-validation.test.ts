import { describe, expect, it } from "vitest";

import {
  emailSchema,
  forgotPasswordSchema,
  passwordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validation/auth";

describe("emailSchema", () => {
  it("accepts and normalizes valid emails", () => {
    expect(emailSchema.parse("  User@Example.COM ")).toBe("user@example.com");
  });

  it("rejects malformed emails", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
    expect(emailSchema.safeParse("").success).toBe(false);
    expect(emailSchema.safeParse("a@b").success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("requires length, a letter, and a digit", () => {
    expect(passwordSchema.safeParse("Sh0rt!a").success).toBe(false); // too short
    expect(passwordSchema.safeParse("onlyletterslong").success).toBe(false); // no digit
    expect(passwordSchema.safeParse("12345678901").success).toBe(false); // no letter
    expect(passwordSchema.safeParse("Valid-Pass-2026").success).toBe(true);
  });

  it("rejects over the 72-byte bcrypt cap", () => {
    const long = `a1${"a".repeat(75)}`;
    expect(passwordSchema.safeParse(long).success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("requires both fields", () => {
    expect(signInSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(signInSchema.safeParse({ email: "a@b.co", password: "whatever" }).success).toBe(true);
  });
});

describe("signUpSchema", () => {
  const base = { fullName: "Ada", email: "a@b.co", password: "Valid-Pass-2026", confirmPassword: "Valid-Pass-2026" };

  it("accepts matching passwords", () => {
    expect(signUpSchema.safeParse(base).success).toBe(true);
  });

  it("flags non-matching confirmation on the confirmPassword path", () => {
    const result = signUpSchema.safeParse({ ...base, confirmPassword: "different" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const path = result.error.issues[0]?.path.join(".");
      expect(path).toBe("confirmPassword");
    }
  });

  it("rejects missing names", () => {
    expect(signUpSchema.safeParse({ ...base, fullName: "   " }).success).toBe(false);
  });
});

describe("forgotPasswordSchema / resetPasswordSchema", () => {
  it("validates request email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@b.co" }).success).toBe(true);
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
  });

  it("validates reset confirmation match", () => {
    expect(
      resetPasswordSchema.safeParse({ password: "Valid-Pass-2026", confirmPassword: "Valid-Pass-2026" }).success,
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({ password: "Valid-Pass-2026", confirmPassword: "nope" }).success,
    ).toBe(false);
  });
});
