"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateDocumentAction,
  type DocumentActionState,
} from "@/features/documents/actions";

const initialState: DocumentActionState = { status: "idle" };

/** Metadata editor (rule 11: success + validation + failure feedback inline). */
export function DocumentMetadataForm({
  orgSlug,
  documentId,
  initial,
}: {
  orgSlug: string;
  documentId: string;
  initial: { title: string; category: string; tags: string[]; reviewBy: string | null };
}) {
  const [state, action] = useActionState<DocumentActionState, FormData>(
    async (prev, formData) => updateDocumentAction(orgSlug, documentId, prev, formData),
    initialState,
  );

  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="doc-title">Title</Label>
          <Input id="doc-title" name="title" defaultValue={initial.title} maxLength={200} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="doc-category">Category</Label>
          <Input id="doc-category" name="category" defaultValue={initial.category} maxLength={80} />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="doc-tags">Tags (comma-separated)</Label>
          <Input id="doc-tags" name="tagsText" defaultValue={initial.tags.join(", ")} placeholder="soc2, product" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="doc-review-by">Review by</Label>
          <Input id="doc-review-by" name="reviewBy" type="date" defaultValue={initial.reviewBy ?? ""} />
        </div>
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p role="status" className="text-sm">
          {state.message}
        </p>
      ) : null}

      <div>
        <Button type="submit">Save changes</Button>
      </div>
    </form>
  );
}
