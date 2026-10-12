"use client";

import { useActionState, type ReactElement, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import type { ActionState } from "@/features/trust-center/actions";

/**
 * Shared editor-form wrapper: binds an (orgSlug, prev, formData) action to a
 * useActionState form and renders the success/error line (rule 11 — no silent
 * failures). Server actions are passed from server pages as props.
 */
type ActionFormProps = {
  orgSlug: string;
  action: (orgSlug: string, prev: ActionState | null, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  children?: ReactNode;
  /** Extra hidden inputs (row ids etc.). Undefined values are skipped. */
  hidden?: Record<string, string | undefined>;
  className?: string;
  variant?: "default" | "outline";
  disabled?: boolean;
};

function ActionSubmitButton({
  label,
  variant,
  disabled,
}: {
  label: string;
  variant: ActionFormProps["variant"];
  disabled: boolean;
}): ReactElement {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={disabled || pending} aria-busy={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function ActionForm({
  orgSlug,
  action,
  submitLabel,
  children,
  hidden,
  className,
  variant = "default",
  disabled = false,
}: ActionFormProps): ReactElement {
  const [state, formAction] = useActionState<ActionState | null, FormData>(
    (prev, formData) => action(orgSlug, prev, formData),
    null,
  );

  return (
    <form action={formAction} className={className}>
      {Object.entries(hidden ?? {})
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      {children}
      <ActionSubmitButton label={submitLabel} variant={variant} disabled={disabled} />
      {state !== null && state.status !== "idle" ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={state.status === "error" ? "text-destructive text-sm" : "text-muted-foreground text-sm"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
