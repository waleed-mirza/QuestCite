"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction, type FormState } from "@/features/auth/actions";
import { FieldError, FormBanner, SubmitButton } from "@/features/auth/components/form-primitives";

const initialState: FormState = { status: "idle" };

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, initialState);
  const fields = state.status === "error" ? (state.fields ?? {}) : {};

  return (
    <form action={action} className="grid gap-4" aria-label="Password reset request form" noValidate>
      <FormBanner state={state} />
      <div className="grid gap-2">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          aria-invalid={fields.email !== undefined}
          aria-describedby={fields.email !== undefined ? "email-error" : undefined}
        />
        <span id="email-error">
          <FieldError message={fields.email} />
        </span>
      </div>
      <SubmitButton label="Send reset link" pendingLabel="Sending…" />
      <p className="text-muted-foreground text-sm">
        Remembered it?{" "}
        <Link href="/login" className="text-foreground font-medium underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
