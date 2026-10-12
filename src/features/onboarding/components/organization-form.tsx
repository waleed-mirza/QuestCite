"use client";

import { useActionState, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/features/auth/actions";
import { createOrganizationAction } from "@/features/onboarding/actions";
import { FieldError, FormBanner, SubmitButton } from "@/features/auth/components/form-primitives";
import { deriveSlug, slugSchema, SLUG_MAX } from "@/lib/validation/org";

const initialState: FormState = { status: "idle" };

/**
 * Name → derived editable address. The field auto-fills from the name until
 * the user edits it manually; live validation mirrors the database rules for
 * fast feedback, which stays the enforcement layer.
 */
export function OrganizationForm() {
  const [state, action] = useActionState(createOrganizationAction, initialState);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  const effectiveSlug = slugEdited ? slug : deriveSlug(name);
  // Parse live for hints; the server revalidates.
  const liveResult = slugSchema.safeParse(effectiveSlug);
  const hint =
    effectiveSlug === ""
      ? "Your workspace lives at /app/<address>."
      : liveResult.success
        ? "Looks good — we'll confirm availability on submit."
        : (liveResult.error.issues[0]?.message ?? "Check the address.");
  const fields = state.status === "error" ? (state.fields ?? {}) : {};

  return (
    <form action={action} className="grid gap-4" aria-label="Create workspace form" noValidate>
      <FormBanner state={state} />
      <div className="grid gap-2">
        <Label htmlFor="name">Workspace name</Label>
        <Input
          id="name"
          name="name"
          type="text"
          autoComplete="organization"
          placeholder="Acme Robotics"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={fields.name !== undefined}
          aria-describedby={fields.name !== undefined ? "name-error" : undefined}
        />
        <span id="name-error">
          <FieldError message={fields.name} />
        </span>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="slug">Workspace address</Label>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-muted-foreground text-sm">
            /app/
          </span>
          <Input
            id="slug"
            name="slug"
            type="text"
            autoComplete="off"
            spellCheck={false}
            required
            value={effectiveSlug}
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(event.target.value.toLowerCase());
            }}
            maxLength={SLUG_MAX}
            aria-invalid={fields.slug !== undefined || !liveResult.success}
            aria-describedby="slug-hint slug-error"
            className="flex-1"
          />
        </div>
        <p id="slug-hint" className="text-muted-foreground text-xs">
          {hint}
        </p>
        <span id="slug-error">
          <FieldError message={fields.slug} />
        </span>
      </div>
      <SubmitButton label="Create workspace" pendingLabel="Creating…" />
    </form>
  );
}
