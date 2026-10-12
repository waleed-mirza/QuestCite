"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  submitAccessRequestAction,
  type PublicSubmitState,
} from "@/features/trust-center/actions";
import type { PublicTrustCenter } from "@/server/services/trust-public";

/**
 * Anonymous access-request form (J8): identity, requested documents, and the
 * displayed clickwrap terms. Validation + rate limiting + requestability all
 * re-checked server-side by the RPC; this form is the friendly first gate.
 */
export function RequestForm({ slug, data }: { slug: string; data: PublicTrustCenter }) {
  const searchParams = useSearchParams();
  const preselected = searchParams.get("doc");
  const [state, formAction] = useActionState<PublicSubmitState | null, FormData>(
    (prev, formData) => submitAccessRequestAction(slug, prev, formData),
    null,
  );

  if (state !== null && state.status === "submitted") {
    return (
      <div role="status" className="grid gap-3 rounded-lg border p-6">
        <h2 className="text-lg font-semibold">Request received</h2>
        <p className="text-sm">
          {state.requiresEmailVerification
            ? "Check your inbox to confirm your email. The team will review your request after confirmation."
            : "Thanks — we'll review your request and email you. Nothing is shared until a human approves it."}
        </p>
        <Link href={`/trust/${slug}`} className="text-sm underline">
          Back to the Trust Center
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="req-name">Name</Label>
          <Input id="req-name" name="name" autoComplete="name" required maxLength={120} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="req-company">Company</Label>
          <Input id="req-company" name="company" autoComplete="organization" required maxLength={160} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="req-email">Work email</Label>
        <Input id="req-email" name="email" type="email" autoComplete="email" required maxLength={254} />
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Documents</legend>
        {data.documents.map((doc) => (
          <label key={doc.documentId} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="documentId"
              value={doc.documentId}
              defaultChecked={preselected === doc.documentId || data.documents.length === 1}
              className="mt-0.5 size-4"
            />
            <span>
              {doc.title} — <span className="text-muted-foreground">{doc.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Read the terms (version {data.termsVersion})</summary>
        <p className="text-muted-foreground mt-2 max-h-60 overflow-y-auto whitespace-pre-line">{data.termsText}</p>
      </details>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="acceptTerms" required className="mt-0.5 size-4" />
        <span>I accept the terms (version {data.termsVersion})</span>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit">Submit request</Button>
        {state !== null && state.status === "error" ? (
          <p role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
