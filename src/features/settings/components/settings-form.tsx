"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateWorkspaceSettingsAction, type SettingsActionState } from "@/features/settings/actions";

const initialState: SettingsActionState = { status: "idle" };

export function WorkspaceSettingsForm({
  orgSlug,
  retentionDays,
  aiDraftsDisabled,
}: {
  orgSlug: string;
  retentionDays: number;
  aiDraftsDisabled: boolean;
}) {
  const [state, action] = useActionState<SettingsActionState, FormData>(
    (previous, formData) => updateWorkspaceSettingsAction(orgSlug, previous, formData),
    initialState,
  );

  return (
    <form action={action} className="grid gap-4" aria-label="Workspace settings">
      {state.status !== "idle" ? <p className={state.status === "error" ? "text-destructive text-sm" : "text-sm"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
      <div className="grid gap-1.5 max-w-sm">
        <Label htmlFor="retention-days">Operational log retention (days)</Label>
        <Input id="retention-days" name="retentionDays" type="number" min={30} max={3650} defaultValue={retentionDays} required />
        <p className="text-muted-foreground text-xs">This prunes operational history only. Documents and questionnaire content are not silently removed.</p>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input name="aiDraftsDisabled" type="checkbox" defaultChecked={aiDraftsDisabled} className="mt-0.5 size-4" />
        <span><span className="font-medium">Disable AI drafting</span><span className="text-muted-foreground block text-xs">Existing drafts remain available; new AI runs are blocked for this workspace.</span></span>
      </label>
      <div><SubmitButton>Save settings</SubmitButton></div>
    </form>
  );
}
function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Saving…" : children}</Button>;
}
