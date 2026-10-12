"use client";

import { useActionState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordAction, type FormState } from "@/features/auth/actions";
import { FieldError, FormBanner, SubmitButton } from "@/features/auth/components/form-primitives";

const initialState: FormState = { status: "idle" };

export function ResetPasswordForm() {
  const [state, action] = useActionState(resetPasswordAction, initialState);
  const fields = state.status === "error" ? (state.fields ?? {}) : {};

  return (
    <form action={action} className="grid gap-4" aria-label="Set a new password form" noValidate>
      <FormBanner state={state} />
      <div className="grid gap-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-describedby="password-hint password-error"
          aria-invalid={fields.password !== undefined}
        />
        <p id="password-hint" className="text-muted-foreground text-xs">
          At least 10 characters, with a letter and a digit.
        </p>
        <span id="password-error">
          <FieldError message={fields.password} />
        </span>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={fields.confirmPassword !== undefined}
          aria-describedby={fields.confirmPassword !== undefined ? "confirmPassword-error" : undefined}
        />
        <span id="confirmPassword-error">
          <FieldError message={fields.confirmPassword} />
        </span>
      </div>
      <SubmitButton label="Update password" pendingLabel="Updating…" />
    </form>
  );
}
