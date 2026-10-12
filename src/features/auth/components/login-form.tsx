"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction, type FormState } from "@/features/auth/actions";
import { FieldError, FormBanner, SubmitButton } from "@/features/auth/components/form-primitives";

const initialState: FormState = { status: "idle" };

export function LoginForm() {
  const [state, action] = useActionState(signInAction, initialState);
  const fields = state.status === "error" ? (state.fields ?? {}) : {};

  return (
    <form action={action} className="grid gap-4" aria-label="Sign in form" noValidate>
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
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={fields.password !== undefined}
          aria-describedby={fields.password !== undefined ? "password-error" : undefined}
        />
        <span id="password-error">
          <FieldError message={fields.password} />
        </span>
      </div>
      <SubmitButton label="Sign in" pendingLabel="Signing in…" />
    </form>
  );
}
