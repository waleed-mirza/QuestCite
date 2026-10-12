"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  reviewAccessRequestAction,
  type ActionState,
  type DeniedSuccess,
  type ReviewSuccess,
} from "@/features/trust-center/actions";
import type { QueueRequest } from "@/server/services/trust-center";
import { TC_GRANT_DAYS_DEFAULT, TC_GRANT_DAYS_MAX, TC_GRANT_DAYS_MIN } from "@/lib/validation/trust-center";

type ReviewState = ActionState | ReviewSuccess | DeniedSuccess | null;

/**
 * Approve/deny form for one request (J9 step 2). On approval the RPC returns
 * the raw prospect-link token — rendered here exactly ONCE (hash-only
 * storage; it can never be re-fetched, D019 pattern).
 *
 * D026: the decision rides a <select> value — a clicked submit button's
 * name/value is NOT delivered to server actions in this stack.
 */
export function ReviewForm({
  orgSlug,
  trustSlug,
  request,
  requestedDocuments,
}: {
  orgSlug: string;
  trustSlug: string;
  request: QueueRequest;
  requestedDocuments: Array<{ id: string; title: string }>;
}) {
  const [state, formAction] = useActionState<ReviewState, FormData>(
    (prev, formData) => reviewAccessRequestAction(orgSlug, trustSlug, prev, formData),
    null,
  );

  if (state !== null && state.status === "approved") {
    return (
      <div className="grid gap-2 text-sm" role="status">
        <p className="font-medium">Approved — share this one-time access link (shown once):</p>
        <div className="flex gap-2">
          <Input readOnly value={state.accessUrl} onFocus={(event) => event.currentTarget.select()} />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(`${window.location.origin}${state.accessUrl}`);
            }}
          >
            Copy
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Grants are valid for {state.expiresHint}. The link stops working when the grants expire.
        </p>
      </div>
    );
  }

  if (state !== null && state.status === "denied") {
    return (
      <p role="status" className="text-sm">
        Request denied. The prospect sees a generic decline — no document existence is revealed.
      </p>
    );
  }

  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="requestId" value={request.id} />
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm">Documents to grant (must be part of the request)</legend>
        {requestedDocuments.map((doc) => (
          <label key={doc.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="documentId" value={doc.id} defaultChecked className="size-4" />
            <span>{doc.title}</span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-1.5">
        <Label htmlFor={`grant-days-${request.id}`}>Grant validity (days, 1–30)</Label>
        <Input
          id={`grant-days-${request.id}`}
          name="grantDays"
          type="number"
          min={TC_GRANT_DAYS_MIN}
          max={TC_GRANT_DAYS_MAX}
          defaultValue={TC_GRANT_DAYS_DEFAULT}
          required
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`decision-${request.id}`} className="sr-only">
          Decision
        </Label>
        <select
          id={`decision-${request.id}`}
          name="decision"
          defaultValue="approved"
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          <option value="approved">Approve</option>
          <option value="denied">Deny</option>
        </select>
        <Button type="submit">Apply decision</Button>
      </div>
      {state !== null && state.status === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
