"use server";

import { redirect } from "next/navigation";

import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { appConfig } from "@/config/app";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  fieldErrors,
} from "@/lib/validation/auth";
import { getUser } from "@/server/auth/session";

/**
 * Auth Server Actions (plan §7). Every action validates input with Zod,
 * talks to Supabase Auth through the cookie-backed server client, and maps
 * provider errors to safe user-facing messages — provider text, emails, and
 * codes never reach the client or the logs (plan §16, AGENTS.md rule 8).
 */

export type FieldErrors = Record<string, string>;

export type FormState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string; fields?: FieldErrors };

const GENERIC_ERROR = "Something went wrong. Please try again.";

function safeAuthError(error: { status?: number | undefined; message?: string | undefined }, fallback: string): string {
  // 400 invalid credentials · 422 unprocessable · 429 rate limit
  if (error.status === 429) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  return fallback;
}

function logAuthFailure(action: string, error: unknown): void {
  // Deliberately minimal: action name and message class only — never the
  // email, password, provider message, or tokens.
  const detail = error instanceof Error ? error.message : "unknown";
  logger.warn("auth action failed", { action, detail: detail.slice(0, 80) });
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Check the highlighted fields.", fields: fieldErrors(parsed.error) };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error !== null) {
    logAuthFailure("signIn", error);
    return { status: "error", message: safeAuthError(error, "Invalid email or password.") };
  }

  redirect("/onboarding");
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Check the highlighted fields.", fields: fieldErrors(parsed.error) };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${appConfig.url}/auth/callback?next=/onboarding`,
    },
  });

  if (error !== null) {
    logAuthFailure("signUp", error);
    // J1: an already-registered email routes the visitor to login instead.
    if (error.message.toLowerCase().includes("already registered")) {
      return { status: "error", message: "This email already has an account — sign in instead." };
    }
    return { status: "error", message: safeAuthError(error, GENERIC_ERROR) };
  }

  // Email confirmation is ON (prod parity): no session yet — show the
  // check-your-inbox state. If confirmation is ever disabled, signUp returns
  // a session and the visitor continues straight to onboarding.
  if (data.session !== null) {
    redirect("/onboarding");
  }
  return { status: "success", message: "Check your inbox for a verification link to finish creating your account." };
}

export async function requestPasswordResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { status: "error", message: "Check the highlighted fields.", fields: fieldErrors(parsed.error) };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${appConfig.url}/auth/callback?next=/reset-password`,
  });
  if (error !== null) {
    logAuthFailure("requestPasswordReset", error);
    // Still show the neutral success state: the response must not reveal
    // whether the account exists.
    return { status: "success", message: GENERIC_ERROR };
  }

  return {
    status: "success",
    message: "If an account exists for that email, a reset link is on its way.",
  };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Check the highlighted fields.", fields: fieldErrors(parsed.error) };
  }

  // A recovery link session is required; anything else is bounced to login.
  const user = await getUser();
  if (user === null) {
    redirect("/login?error=recovery_required");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error !== null) {
    logAuthFailure("resetPassword", error);
    return { status: "error", message: safeAuthError(error, GENERIC_ERROR) };
  }

  return { status: "success", message: "Password updated. You can now sign in with your new password." };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
