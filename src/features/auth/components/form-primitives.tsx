"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import type { FormState } from "@/features/auth/actions";

/** Submit button bound to its parent form's pending state. */
export function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
      {pending ? (pendingLabel ?? "Working…") : label}
    </Button>
  );
}

/** Announces action results to assistive tech; renders nothing while idle. */
export function FormBanner({ state }: { state: FormState }) {
  if (state.status === "idle") {
    return null;
  }
  const isError = state.status === "error";
  return (
    <p
      role="alert"
      aria-live="polite"
      className={
        isError
          ? "text-destructive text-sm"
          : "text-emerald-700 dark:text-emerald-400 text-sm"
      }
    >
      {state.message}
    </p>
  );
}

/** Per-field validation message, linked via aria-describedby by the caller. */
export function FieldError({ message }: { message?: string | undefined }) {
  if (message === undefined) {
    return null;
  }
  return (
    <p className="text-destructive text-sm">{message}</p>
  );
}
