"use client";

import { useActionState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Button,
} from "@/components/ui/button";
import {
  inviteMemberAction,
  type ActionState,
  type InviteSuccess,
} from "@/features/members/actions";

const initialState: ActionState = { status: "idle" };

/**
 * Invite creation (journey J2 step 1–2). On success the one-time link is
 * shown once, copyable — it is never logged and cannot be re-fetched because
 * only its hash is stored.
 */
export function InviteForm({ orgSlug }: { orgSlug: string }) {
  const [state, action] = useActionState<ActionState | InviteSuccess, FormData>(
    async (prev, formData) => inviteMemberAction(orgSlug, prev, formData),
    initialState,
  );

  if (state.status === "invited") {
    return (
      <div className="grid gap-3 text-sm" role="status">
        <p>
          Invitation created for <span className="text-foreground font-medium">{state.email}</span>.
        </p>
        <div>
          <Label htmlFor="invite-link">One-time invite link (shown once)</Label>
          <div className="mt-1 flex gap-2">
            <Input
              id="invite-link"
              readOnly
              value={state.inviteUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                // Resolve the absolute URL at click time — this component also
                // renders on the server, where `window` does not exist.
                void navigator.clipboard.writeText(`${window.location.origin}${state.inviteUrl}`);
              }}
            >
              Copy
            </Button>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            Anyone opening this link must be signed in as {state.email}. It expires in 7 days and
            works once.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-3" aria-label="Invite member form" noValidate>
      {state.status === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="grid gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="teammate@company.com"
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <select
            id="invite-role"
            name="role"
            defaultValue="viewer"
            className="border-input h-9 rounded-lg border bg-transparent px-3 text-sm"
          >
            <option value="admin">Admin</option>
            <option value="reviewer">Reviewer</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        <div className="flex items-end">
          <Button type="submit">Invite</Button>
        </div>
      </div>
    </form>
  );
}
