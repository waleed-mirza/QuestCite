"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveKnowledgeEntryAction,
  type EntryActionState,
} from "@/features/knowledge/actions";

const initialState: EntryActionState = { status: "idle" };

/**
 * Create/edit form for knowledge entries. Editing always appends a new
 * immutable version (the RPC guarantees entry + history move together) — the
 * copy makes that contract visible before the user saves.
 */
export function KnowledgeEntryForm({
  orgSlug,
  entry,
}: {
  orgSlug: string;
  entry?: { id: string; question: string; answer: string; category: string; tags: string[]; reviewState: string; reviewBy: string | null };
}) {
  const [state, action] = useActionState<EntryActionState, FormData>(
    async (prev, formData) => saveKnowledgeEntryAction(orgSlug, prev, formData),
    initialState,
  );

  return (
    <form action={action} className="grid gap-4" key={state.status === "success" && entry === undefined ? state.entryId : "form"}>
      {entry !== undefined ? <input type="hidden" name="entryId" value={entry.id} /> : null}

      <div className="grid gap-1.5">
        <Label htmlFor="entry-question">Question</Label>
        <Input
          id="entry-question"
          name="question"
          defaultValue={entry?.question}
          placeholder="Is customer data encrypted at rest?"
          required
          maxLength={500}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="entry-answer">Answer</Label>
        <textarea
          id="entry-answer"
          name="answer"
          defaultValue={entry?.answer}
          rows={4}
          required
          maxLength={10000}
          className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive rounded-lg border bg-transparent px-3 py-2 text-sm transition-[color,box-shadow] focus-visible:ring-[3px]"
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="entry-category">Category</Label>
          <Input id="entry-category" name="category" defaultValue={entry?.category} placeholder="general" maxLength={80} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="entry-tags">Tags (comma-separated)</Label>
          <Input id="entry-tags" name="tagsText" defaultValue={entry?.tags.join(", ")} placeholder="soc2, product" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="entry-review-state">Review state</Label>
          <select
            id="entry-review-state"
            name="reviewState"
            defaultValue={entry?.reviewState ?? "draft"}
            className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
          >
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="needs_review">Needs review</option>
            <option value="retired">Retired</option>
          </select>
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
        <Button type="submit">{entry === undefined ? "Create entry" : "Save as new version"}</Button>
      </div>
    </form>
  );
}
