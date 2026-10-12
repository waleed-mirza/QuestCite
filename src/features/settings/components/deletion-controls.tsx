"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cancelOrganizationDeletionAction,
  deleteOrganizationAction,
  requestOrganizationDeletionAction,
  type SettingsActionState,
} from "@/features/settings/actions";

const initialState: SettingsActionState = { status: "idle" };

export function DeletionControls({ orgSlug, requestedAt }: { orgSlug: string; requestedAt: string | null }) {
  const [requestState, requestAction] = useActionState<SettingsActionState, FormData>(
    (previous, formData) => requestOrganizationDeletionAction(orgSlug, previous, formData),
    initialState,
  );
  const [cancelState, cancelAction] = useActionState<SettingsActionState, FormData>(
    (previous, formData) => cancelOrganizationDeletionAction(orgSlug, previous, formData),
    initialState,
  );
  const [deleteState, deleteAction] = useActionState<SettingsActionState, FormData>(
    (previous, formData) => deleteOrganizationAction(orgSlug, previous, formData),
    initialState,
  );

  const requested = requestedAt !== null || requestState.status === "success";
  if (deleteState.status === "success") {
    return <div className="grid gap-3 text-sm" role="status"><p>{deleteState.message}</p><a className="font-medium underline underline-offset-4" href="/onboarding">Go to onboarding</a></div>;
  }

  return (
    <div className="grid gap-4">
      {requestState.status === "error" ? <p className="text-destructive text-sm" role="alert">{requestState.message}</p> : null}
      {cancelState.status === "error" ? <p className="text-destructive text-sm" role="alert">{cancelState.message}</p> : null}
      {deleteState.status === "error" ? <p className="text-destructive text-sm" role="alert">{deleteState.message}</p> : null}
      {!requested ? (
        <form action={requestAction} className="grid gap-3 max-w-md">
          <div className="grid gap-1.5">
            <Label htmlFor="request-deletion-confirmation">Type {orgSlug} to request deletion</Label>
            <Input id="request-deletion-confirmation" name="confirmation" autoComplete="off" required maxLength={120} />
          </div>
          <div><SubmitButton variant="destructive">Request deletion</SubmitButton></div>
        </form>
      ) : (
        <>
          <p className="text-sm">Deletion was requested{requestedAt === null ? " just now" : ` on ${new Date(requestedAt).toLocaleDateString()}`}. This extra step prevents an accidental permanent delete.</p>
          <form action={cancelAction}><SubmitButton variant="outline">Cancel deletion request</SubmitButton></form>
          <form action={deleteAction} className="border-destructive/30 grid gap-3 max-w-md rounded-lg border p-3">
            <div className="grid gap-1.5"><Label htmlFor="delete-confirmation">Type {orgSlug} to permanently delete</Label><Input id="delete-confirmation" name="confirmation" autoComplete="off" required maxLength={120} /></div>
            <SubmitButton variant="destructive">Delete workspace permanently</SubmitButton>
          </form>
        </>
      )}
    </div>
  );
}
function SubmitButton({ children, variant }: { children: React.ReactNode; variant: "default" | "outline" | "destructive" }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant={variant} disabled={pending}>{pending ? "Working…" : children}</Button>;
}
