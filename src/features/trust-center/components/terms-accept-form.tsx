"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import {
  acceptProspectTermsAction,
  type AcceptTermsState,
} from "@/features/trust-center/actions";

/** Clickwrap shown on the gated page when the org's terms changed (J9 step 4). */
export function TermsAcceptForm({
  slug,
  rawToken,
  termsVersion,
  termsText,
}: {
  slug: string;
  rawToken: string;
  termsVersion: string;
  termsText: string;
}) {
  const [state, formAction] = useActionState<AcceptTermsState | null, FormData>(
    (prev, formData) => acceptProspectTermsAction(slug, rawToken, prev, formData),
    null,
  );

  if (state !== null && state.status === "accepted") {
    return (
      <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
        Thank you — the current terms are recorded. Reload if downloads are still locked.
      </p>
    );
  }

  return (
    <form action={formAction} className="grid gap-3 rounded-md border p-3">
      <p className="text-sm font-medium">The terms have changed (version {termsVersion})</p>
      <details>
        <summary className="cursor-pointer text-sm">Read the updated terms</summary>
        <p className="text-muted-foreground mt-2 max-h-60 overflow-y-auto text-sm whitespace-pre-line">{termsText}</p>
      </details>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="acceptTerms" required className="mt-0.5 size-4" />
        <span>I accept the updated terms (version {termsVersion})</span>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit">Accept terms</Button>
        {state !== null && state.status === "error" ? (
          <p role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
