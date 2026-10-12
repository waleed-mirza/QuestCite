"use client";

import type { ReactElement } from "react";

import { ActionForm } from "@/features/trust-center/action-form";
import { saveTrustSlugAction } from "@/features/trust-center/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type TrustSlugFormProps = {
  orgSlug: string;
  currentSlug: string;
};

/** Edits the public address through the guarded, audited slug RPC. */
export function TrustSlugForm({ orgSlug, currentSlug }: TrustSlugFormProps): ReactElement {
  return (
    <ActionForm
      orgSlug={orgSlug}
      action={saveTrustSlugAction}
      submitLabel="Save public URL"
      className="grid gap-2"
      variant="outline"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="tc-public-slug">Public URL slug</Label>
        <Input
          id="tc-public-slug"
          name="slug"
          defaultValue={currentSlug}
          required
          minLength={3}
          maxLength={40}
          pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
          aria-describedby="tc-public-slug-help"
        />
        <p id="tc-public-slug-help" className="text-muted-foreground text-xs">
          Lowercase letters, numbers, and hyphens. Changing it invalidates the old public address.
        </p>
      </div>
    </ActionForm>
  );
}
