import { z } from "zod";

/**
 * Auth input schemas (AGENTS.md rule 6). Messages are user-facing copy — they
 * never echo provider internals. The password policy is documented here:
 * at least 10 characters with at least one letter and one digit, capped at
 * 72 bytes (Supabase/GoTrue's bcrypt input limit).
 */

export const EMAIL_MAX = 254;
export const PASSWORD_MAX = 72;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX, `Email must be at most ${EMAIL_MAX} characters.`)
  .pipe(z.email({ message: "Enter a valid email address." }));

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters.`)
  .regex(/[a-zA-Z]/, "Password must contain at least one letter.")
  .regex(/[0-9]/, "Password must contain at least one digit.");

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const signUpSchema = z
  .object({
  fullName: z.string().trim().min(1, "Enter your name.").max(80, "Name must be at most 80 characters."),
  email: emailSchema,
  password: passwordSchema,
  confirmPassword: z.string(),
})
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
  password: passwordSchema,
  confirmPassword: z.string(),
})
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * Flattens Zod issues into the first user-facing message per field. Returns
 * null when the input is valid.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && result[key] === undefined) {
      result[key] = issue.message;
    }
  }
  return result;
}
