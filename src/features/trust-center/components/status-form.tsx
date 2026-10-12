"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { setTrustStatusAction, type ActionState } from "@/features/trust-center/actions";
import type { Database } from "@/types/database.types";

type Status = Database["public"]["Enums"]["trust_center_status"];

const STATUS_COPY: Record<Status, string> = {
  draft: "Draft — only this workspace can see the Trust Center.",
  preview: "Preview — members only; the public URL stays offline.",
  published: "Published — live for everyone at the public URL.",
};

/** Draft / preview / published lifecycle (plan §W7; publish is RPC-validated). */
export function StatusForm({
  orgSlug,
  status,
  publicUrl,
}: {
  orgSlug: string;
  status: Status;
  publicUrl: string;
}) {
  const [state, formAction] = useActionState<ActionState | null, FormData>(
    (prev, formData) => setTrustStatusAction(orgSlug, prev, formData),
    null,
  );

  return (
    <div className="grid gap-3">
      <p className="text-sm" role="status">
        {STATUS_COPY[status]}
      </p>
      <p className="text-muted-foreground text-sm">
        Public URL:{" "}
        {status === "published" ? (
          <a className="text-foreground underline" href={publicUrl}>
            {publicUrl}
          </a>
        ) : (
          <span>{publicUrl} (offline)</span>
        )}
      </p>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        {/* D026: the operation rides the <select> value — a clicked submit
            button's name/value is NOT delivered to server actions here. */}
        <Label htmlFor="tc-status-target" className="sr-only">
          Set status
        </Label>
        <select
          id="tc-status-target"
          name="status"
          defaultValue={status === "published" ? "draft" : "published"}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          <option value="published">Published</option>
          <option value="preview">Preview</option>
          <option value="draft">Draft</option>
        </select>
        <Button type="submit">Set status</Button>
        {state !== null && state.status !== "idle" ? (
          <p
            role={state.status === "error" ? "alert" : "status"}
            className={state.status === "error" ? "text-destructive text-sm" : "text-muted-foreground text-sm"}
          >
            {state.message}
          </p>
        ) : null}
      </form>
    </div>
  );
}
