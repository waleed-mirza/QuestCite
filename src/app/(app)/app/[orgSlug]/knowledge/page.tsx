import Link from "next/link";
import { Trash2 } from "lucide-react";

import { AccessDenied } from "@/components/feedback/access-denied";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deleteKnowledgeEntryAction } from "@/features/knowledge/actions";
import { KnowledgeEntryForm } from "@/features/knowledge/components/entry-form";
import { ENTRY_REVIEW_STATES, listEntryCategories, listKnowledgeEntries } from "@/features/knowledge/server";
import { guardOrgRoles } from "@/server/authorization/guard";

/**
 * Knowledge entries (plan §W3, PRD §6): short approved Q&A pairs with
 * immutable version history — the preferred evidence class at retrieval time.
 * Search covers question + answer (full-text), category, and review state
 * ("search across title, content, category, and status"). Owner/admin manage;
 * reviewers/viewers read (PRD §5).
 */

const STATE_STYLES: Record<string, string> = {
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  draft: "bg-muted text-muted-foreground",
  needs_review: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  retired: "bg-muted text-muted-foreground line-through",
};

export default async function KnowledgePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const single = (value: string | string[] | undefined): string =>
    Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  const reviewStateParam = single(sp.state);
  type ReviewStateFilter = (typeof ENTRY_REVIEW_STATES)[number] | "all";
  const parsedReviewState: ReviewStateFilter = (ENTRY_REVIEW_STATES as readonly string[]).includes(reviewStateParam)
    ? (reviewStateParam as Exclude<ReviewStateFilter, "all">)
    : "all";

  const filters = {
    query: single(sp.q).slice(0, 120),
    category: single(sp.category).slice(0, 80),
    reviewState: parsedReviewState,
  };

  const guard = await guardOrgRoles(orgSlug, ["owner", "admin", "reviewer", "viewer"]);
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return null;
    }
    if (guard.reason === "forbidden") {
      return <AccessDenied what="this workspace" />;
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>Workspace not found</CardTitle>
          <CardDescription>You may not be a member of this workspace.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [entries, categories] = await Promise.all([
    listKnowledgeEntries(guard.ctx.organization.id, filters),
    listEntryCategories(guard.ctx.organization.id),
  ]);
  const canManage = guard.ctx.role === "owner" || guard.ctx.role === "admin";
  const hasFilters = filters.query !== "" || filters.category !== "" || filters.reviewState !== "all";

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge entries</h1>
        <p className="text-muted-foreground mt-1">
          Short, approved question-and-answer pairs — the first place the AI looks for evidence.
        </p>
      </div>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>New entry</CardTitle>
            <CardDescription>
              Saving an edit appends a new version — the history is immutable, so past answers stay
              auditable.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <KnowledgeEntryForm orgSlug={orgSlug} />
          </CardContent>
        </Card>
      ) : null}

      <form method="get" className="flex flex-wrap items-end gap-2" role="search">
        <div className="grid gap-1.5">
          <label className="sr-only" htmlFor="entry-search">
            Search entries
          </label>
          <Input id="entry-search" name="q" defaultValue={filters.query} placeholder="Search questions and answers…" className="sm:w-72" />
        </div>
        <div className="grid gap-1.5">
          <label className="sr-only" htmlFor="entry-category">
            Category
          </label>
          <select
            id="entry-category"
            name="category"
            defaultValue={filters.category}
            className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label className="sr-only" htmlFor="entry-state">
            Filter by review state
          </label>
          <select
            id="entry-state"
            name="state"
            defaultValue={filters.reviewState}
            className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
          >
            <option value="all">All states</option>
            {ENTRY_REVIEW_STATES.map((state) => (
              <option key={state} value={state}>
                {state.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Entries</CardTitle>
          <CardDescription>
            {entries.length === 0
              ? hasFilters
                ? "Nothing matches these filters."
                : "No entries yet."
              : `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {hasFilters
                ? "Nothing matches these filters. Try different terms or clear them."
                : canManage
                  ? "Create your first entry above — approved entries become preferred evidence for AI answers."
                  : "No entries yet — owners and admins can add them."}
            </p>
          ) : (
            <ul className="divide-border/60 divide-y">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLES[entry.review_state] ?? STATE_STYLES.draft}`}
                      >
                        {entry.review_state.replace("_", " ")}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {entry.versionCount} version{entry.versionCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <Link
                      href={`/app/${orgSlug}/knowledge/${entry.id}`}
                      className="mt-1 block text-sm font-medium hover:underline"
                    >
                      {entry.question}
                    </Link>
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-sm">{entry.answer}</p>
                    <p className="text-muted-foreground mt-1 text-xs capitalize">
                      {entry.category}
                      {entry.tags.length > 0 ? ` · ${entry.tags.join(", ")}` : ""}
                    </p>
                  </div>
                  {canManage ? (
                    <form action={deleteKnowledgeEntryAction.bind(null, orgSlug)}>
                      <input type="hidden" name="entryId" value={entry.id} />
                      <Button type="submit" variant="ghost" size="sm" aria-label={`Delete ${entry.question}`}>
                        <Trash2 aria-hidden="true" />
                        Delete
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        Editing an entry never rewrites history — every save appends a version the workspace can audit.
      </p>
    </div>
  );
}
