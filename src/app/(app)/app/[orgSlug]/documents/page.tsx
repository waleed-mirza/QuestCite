import Link from "next/link";
import { FileText, Search } from "lucide-react";

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
import { UploadForm } from "@/features/documents/components/upload-form";
import { listDocuments, listCategories } from "@/features/documents/server";
import { guardOrgRoles } from "@/server/authorization/guard";

/**
 * Knowledge documents (plan §W3): searchable library with processing states.
 * Owner/admin manage; reviewers/viewers read (PRD §5). Search covers title,
 * content (chunk full-text), category, and processing/state filters.
 */

const STATE_STYLES: Record<string, string> = {
  ready: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  failed: "bg-red-500/15 text-red-700 dark:text-red-400",
  pending: "bg-muted text-muted-foreground",
  parsing: "bg-muted text-muted-foreground",
  embedding: "bg-muted text-muted-foreground",
};

export default async function DocumentsPage({
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

  const filters = {
    query: single(sp.q).slice(0, 120),
    category: single(sp.category).slice(0, 80),
    state: (["active", "archived", "all"].includes(single(sp.state)) ? single(sp.state) : "active") as
      | "active"
      | "archived"
      | "all",
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

  const [documents, categories] = await Promise.all([
    listDocuments(guard.ctx.organization.id, filters),
    listCategories(guard.ctx.organization.id),
  ]);
  const canManage = guard.ctx.role === "owner" || guard.ctx.role === "admin";

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge documents</h1>
        <p className="text-muted-foreground mt-1">
          Approved evidence the AI answers from — private to {guard.ctx.organization.name}.
        </p>
      </div>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Upload a document</CardTitle>
            <CardDescription>
              Text-based PDF, DOCX, TXT, or Markdown up to 10 MB. Files are parsed, chunked, and made
              searchable — nothing leaves your workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UploadForm orgSlug={orgSlug} />
          </CardContent>
        </Card>
      ) : null}

      <form method="get" className="flex flex-wrap items-end gap-2" role="search">
        <div className="grid gap-1.5">
          <label className="sr-only" htmlFor="doc-search">
            Search documents
          </label>
          <div className="relative">
            <Search aria-hidden="true" className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
            <Input
              id="doc-search"
              name="q"
              defaultValue={filters.query}
              placeholder="Search title and content…"
              className="pl-8 sm:w-72"
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <label className="sr-only" htmlFor="doc-category">
            Category
          </label>
          <select
            id="doc-category"
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
          <label className="sr-only" htmlFor="doc-state">
            State
          </label>
          <select
            id="doc-state"
            name="state"
            defaultValue={filters.state}
            className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Library</CardTitle>
          <CardDescription>
            {documents.length === 0
              ? "No documents match."
              : `${documents.length} document${documents.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-sm">
              <FileText aria-hidden="true" className="size-8" />
              {filters.query !== "" || filters.category !== "" ? (
                <p>Nothing matches this search. Try different terms or clear the filters.</p>
              ) : canManage ? (
                <p>Upload your first policy, FAQ, or certification to build the knowledge base.</p>
              ) : (
                <p>No documents yet — owners and admins can upload them.</p>
              )}
            </div>
          ) : (
            <ul className="divide-border/60 divide-y">
              {documents.map((doc) => {
                const state = doc.currentVersion?.processing_state ?? "pending";
                const href = `/app/${orgSlug}/documents/${doc.id}`;
                return (
                  <li key={doc.id} className="py-2.5">
                    <Link href={href} className="group flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium group-hover:underline">{doc.title}</p>
                        <p className="text-muted-foreground truncate text-xs capitalize">
                          {doc.category}
                          {doc.tags.length > 0 ? ` · ${doc.tags.join(", ")}` : ""}
                          {` · v${doc.currentVersion?.version_number ?? "–"} · ${doc.versionCount} version${doc.versionCount === 1 ? "" : "s"}`}
                          {` · updated ${new Date(doc.updated_at).toLocaleDateString()}`}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATE_STYLES[state] ?? STATE_STYLES.pending}`}
                      >
                        {state}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        Tip: content search looks inside documents (private full-text over extracted text); the badge shows
        processing state — failed documents can be retried from their page.
      </p>
    </div>
  );
}
