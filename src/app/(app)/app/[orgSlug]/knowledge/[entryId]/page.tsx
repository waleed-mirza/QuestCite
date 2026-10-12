import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessDenied } from "@/components/feedback/access-denied";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KnowledgeEntryForm } from "@/features/knowledge/components/entry-form";
import { getEntryWithHistory } from "@/features/knowledge/server";
import { guardOrgRoles } from "@/server/authorization/guard";

/**
 * Entry detail + edit (plan §W3): shows the immutable version history and the
 * edit form (owner/admin). Every save appends a version — the history is the
 * audit trail for what the entry said over time.
 */
export default async function KnowledgeEntryDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; entryId: string }>;
}) {
  const { orgSlug, entryId } = await params;
  const guard = await guardOrgRoles(orgSlug, ["owner", "admin", "reviewer", "viewer"]);
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return null;
    }
    if (guard.reason === "forbidden") {
      return <AccessDenied what="this workspace" />;
    }
    notFound();
  }

  const detail = await getEntryWithHistory(guard.ctx.organization.id, entryId);
  if (detail === null) {
    notFound();
  }
  const { entry, versions } = detail;
  const canManage = guard.ctx.role === "owner" || guard.ctx.role === "admin";

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <div>
        <Link href={`/app/${orgSlug}/knowledge`} className="text-muted-foreground text-sm hover:underline">
          ← All entries
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{entry.question}</h1>
        <p className="text-muted-foreground mt-1 text-sm capitalize">
          {entry.category}
          {entry.tags.length > 0 ? ` · ${entry.tags.join(", ")}` : ""}
          {` · ${entry.review_state.replace("_", " ")}`}
        </p>
      </div>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit entry</CardTitle>
            <CardDescription>Saving appends a new immutable version; the current answer updates.</CardDescription>
          </CardHeader>
          <CardContent>
            <KnowledgeEntryForm
              orgSlug={orgSlug}
              entry={{
                id: entry.id,
                question: entry.question,
                answer: entry.answer,
                category: entry.category,
                tags: entry.tags,
                reviewState: entry.review_state,
                reviewBy: entry.review_by,
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Version history</CardTitle>
          <CardDescription>Immutable record of every edit, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="divide-border/60 divide-y">
            {versions.map((version) => (
              <li key={version.id} className="py-3">
                <p className="text-sm font-medium">
                  Version {version.version_number}
                  {version.version_number === versions[0]?.version_number ? " · current" : ""}
                  <span className="text-muted-foreground ml-2 text-xs font-normal">
                    {new Date(version.created_at).toLocaleString()}
                  </span>
                </p>
                <p className="mt-1 text-sm">{version.question}</p>
                <p className="text-muted-foreground mt-0.5 text-sm">{version.answer}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
