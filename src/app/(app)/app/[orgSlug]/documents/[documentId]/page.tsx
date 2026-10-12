import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, Download, RotateCcw, Trash2 } from "lucide-react";

import { AccessDenied } from "@/components/feedback/access-denied";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  archiveDocumentAction,
  deleteDocumentAction,
  restoreDocumentAction,
  retryIngestAction,
} from "@/features/documents/actions";
import { DocumentMetadataForm } from "@/features/documents/components/metadata-form";
import { UploadForm } from "@/features/documents/components/upload-form";
import { getDocumentDetail } from "@/features/documents/server";
import { isRetryable } from "@/features/documents/ingestion";
import { guardOrgRoles } from "@/server/authorization/guard";

/**
 * Document detail (plan §W3): metadata, version history with processing
 * states, retry for failed versions, archive/restore/delete, downloads via
 * short-lived signed URLs. Owner/admin controls; viewers/reviewers read.
 */

const PROCESSING_COPY: Record<string, string> = {
  CHECKSUM_MISMATCH: "The stored file failed its integrity check. Retry the upload or the processing.",
  PARSER_FAILED: "The file could not be read. It may be corrupt or use unsupported features.",
  EMPTY_DOCUMENT: "No text could be extracted (scanned/image-only PDFs are not supported).",
  ENCRYPTED_DOCUMENT: "The PDF is password-protected. Remove protection and upload again.",
  ENCODING_UNSUPPORTED: "Text files must be UTF-8.",
  UNSUPPORTED_TYPE: "That file type is not supported.",
  EMBEDDING_UNAVAILABLE: "AI search is not configured for this deployment (embedding provider missing).",
  EMBEDDING_FAILED: "The search index step failed. Retrying usually fixes this.",
  CHUNK_INSERT_FAILED: "Search index storage failed. Retrying usually fixes this.",
};

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; documentId: string }>;
}) {
  const { orgSlug, documentId } = await params;
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

  const detail = await getDocumentDetail(guard.ctx.organization.id, documentId);
  if (detail === null) {
    notFound();
  }
  const { document: doc, versions, chunkCount, ownerName } = detail;
  const canManage = guard.ctx.role === "owner" || guard.ctx.role === "admin";
  const reviewOverdue = doc.review_by !== null && new Date(`${doc.review_by}T23:59:59`) < new Date();

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <div>
        <Link href={`/app/${orgSlug}/documents`} className="text-muted-foreground text-sm hover:underline">
          ← All documents
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${doc.state === "archived" ? "bg-muted text-muted-foreground" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"}`}>
            {doc.state}
          </span>
        </div>
        <p className="text-muted-foreground mt-1 text-sm capitalize">
          {doc.category}
          {doc.tags.length > 0 ? ` · ${doc.tags.join(", ")}` : ""}
          {` · ${ownerName !== null ? `owned by ${ownerName}` : "owner removed"}`}
          {` · ${chunkCount !== null ? `${chunkCount} searchable sections` : "not processed yet"}`}
        </p>
        {doc.review_by !== null ? (
          <p className={`mt-1 text-xs ${reviewOverdue ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
            {reviewOverdue ? "Review overdue — due " : "Scheduled for review "}
            {new Date(`${doc.review_by}T00:00:00`).toLocaleDateString()}
          </p>
        ) : null}
      </div>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>Category and tags shape how evidence is filtered later.</CardDescription>
          </CardHeader>
          <CardContent>
            <DocumentMetadataForm
              orgSlug={orgSlug}
              documentId={doc.id}
              initial={{ title: doc.title, category: doc.category, tags: doc.tags, reviewBy: doc.review_by }}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Versions</CardTitle>
          <CardDescription>
            Uploads are immutable: a new file becomes a new version. Only the latest ready version feeds
            search.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-border/60 divide-y">
            {versions.map((version) => (
              <li key={version.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    Version {version.version_number}
                    {version.id === versions[0]?.id ? " · latest" : ""}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(version.created_at).toLocaleString()} ·{" "}
                    {(version.byte_size / 1024).toFixed(0)} KB
                    {version.page_count !== null ? ` · ${version.page_count} pages` : ""}
                    {version.char_count !== null ? ` · ${version.char_count.toLocaleString()} chars` : ""}
                  </p>
                  {version.processing_state === "failed" && version.processing_error_code !== null ? (
                    <p role="alert" className="text-destructive mt-1 text-xs">
                      {PROCESSING_COPY[version.processing_error_code] ?? "Processing failed."}
                      {isRetryable(version.processing_error_code) ? " This failure is retryable." : ""}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <a href={`/api/documents/${doc.id}/versions/${version.id}/download`} download>
                    <Button type="button" variant="ghost" size="sm">
                      <Download aria-hidden="true" />
                      Download
                    </Button>
                  </a>
                  {canManage && version.processing_state === "failed" && isRetryable(version.processing_error_code ?? "") ? (
                    <form action={retryIngestAction.bind(null, orgSlug, doc.id)}>
                      <input type="hidden" name="versionId" value={version.id} />
                      <Button type="submit" variant="outline" size="sm">
                        <RotateCcw aria-hidden="true" />
                        Retry
                      </Button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          {canManage ? (
            <div className="border-border/60 mt-4 border-t pt-4">
              <p className="text-muted-foreground mb-2 text-xs">
                Add another version of this document (e.g. after a policy update):
              </p>
              <UploadForm orgSlug={orgSlug} documentId={doc.id} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Manage</CardTitle>
            <CardDescription>
              Archiving hides the document from search and the AI. Deleting removes it and its file
              permanently.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              {doc.state === "active" ? (
                <form action={archiveDocumentAction.bind(null, orgSlug)}>
                  <input type="hidden" name="documentId" value={doc.id} />
                  <Button type="submit" variant="outline">
                    <Archive aria-hidden="true" />
                    Archive
                  </Button>
                </form>
              ) : (
                <form action={restoreDocumentAction.bind(null, orgSlug)}>
                  <input type="hidden" name="documentId" value={doc.id} />
                  <Button type="submit" variant="outline">
                    <ArchiveRestore aria-hidden="true" />
                    Restore
                  </Button>
                </form>
              )}
              <form action={deleteDocumentAction.bind(null, orgSlug)}>
                <input type="hidden" name="documentId" value={doc.id} />
                <Button type="submit" variant="destructive">
                  <Trash2 aria-hidden="true" />
                  Delete permanently
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
