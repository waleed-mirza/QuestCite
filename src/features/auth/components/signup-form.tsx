"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpAction, type FormState } from "@/features/auth/actions";
import { FieldError, FormBanner, SubmitButton } from "@/features/auth/components/form-primitives";

const initialState: FormState = { status: "idle" };

export function SignupForm() {
  const [state, action] = useActionState(signUpAction, initialState);
  const fields = state.status === "error" ? (state.fields ?? {}) : {};

  if (state.status === "success") {
    return (
      <div className="grid gap-3 text-sm" role="status">
        <h2 className="text-foreground text-base font-semibold">Check your inbox</h2>
        <p className="text-muted-foreground">{state.message}</p>
        <Link href="/login" className="text-foreground font-medium underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4" aria-label="Create account form" noValidate>
      <FormBanner state={state} />
      <div className="grid gap-2">
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          placeholder="Ada Lovelace"
          required
          aria-invalid={fields.fullName !== undefined}
          aria-describedby={fields.fullName !== undefined ? "fullName-error" : undefined}
        />
        <span id="fullName-error">
          <FieldError message={fields.fullName} />
        </span>
      </div>
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
          aria-describedby={fields.email !== undefined ? "signup-email-error" : undefined}
        />
        <span id="signup-email-error">
          <FieldError message={fields.email} />
        </span>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
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
        <Label htmlFor="confirmPassword">Confirm password</Label>
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
      <SubmitButton label="Create account" pendingLabel="Creating account…" />
    </form>
  );
}
