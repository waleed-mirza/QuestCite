import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/features/trust-center/action-form";
import { revokeGrantAction } from "@/features/trust-center/actions";
import { ReviewForm } from "@/features/trust-center/components/review-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAccessRequestQueue } from "@/server/services/trust-center";
import { requireOrgRole } from "@/server/authorization/org";

/**
 * Access request queue (journey J9, wireframe §8): requester, company,
 * requested documents, terms acceptance, state; approve (documents + expiry)
 * / deny; grant revocation. Owner/admin only; the DB re-checks every action.
 */

const STATE_LABELS: Record<string, string> = {
  submitted: "Awaiting email confirmation",
  pending_review: "Pending review",
  approved: "Approved",
  denied: "Denied",
  expired: "Expired",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }): Promise<Metadata> {
  const { orgSlug } = await params;
  return { title: `Access requests · ${orgSlug}` };
}

export default async function AccessRequestsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);

  const [requests, supabase] = await Promise.all([
    getAccessRequestQueue(orgSlug),
    createSupabaseServerClient(),
  ]);

  const { data: trustCenter } = await supabase
    .from("trust_centers")
    .select("slug")
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const trustSlug = trustCenter?.slug ?? orgSlug;

  const { data: titleRows } = await supabase
    .from("documents")
    .select("id, title")
    .eq("organization_id", ctx.organization.id);
  const titles = new Map(
    ((titleRows ?? []) as Array<{ id: string; title: string }>).map((row) => [row.id, row.title] as const),
  );

  const pending = requests.filter((request) => request.state === "pending_review" || request.state === "submitted");
  const resolved = requests.filter((request) => request.state !== "pending_review" && request.state !== "submitted");

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Access requests</h1>
        <p className="text-muted-foreground text-sm">
          Prospects requesting gated documents from your Trust Center ({trustSlug}).
        </p>
      </header>

      <section aria-labelledby="pending-requests" className="grid gap-3">
        <h2 id="pending-requests" className="text-lg font-medium">
          Awaiting review ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border p-4 text-sm">
            No pending requests. New submissions appear here and in your notifications.
          </p>
        ) : null}
        {pending.map((request) => {
          const requestedDocuments = request.requestedDocumentIds.map((id) => ({
            id,
            title: titles.get(id) ?? "Removed document",
          }));
          return (
            <article key={request.id} className="grid gap-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {request.prospectName} · {request.prospectCompany}
                  </p>
                  <p className="text-muted-foreground text-sm">{request.prospectEmail}</p>
                </div>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                  {STATE_LABELS[request.state] ?? request.state}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                Submitted {formatDate(request.createdAt)} · accepted terms {request.acceptedTermsVersion ?? "not recorded"} ·
                expires {formatDate(request.requestExpiresAt)}
              </p>
              {request.state === "pending_review" ? (
                <ReviewForm
                  orgSlug={orgSlug}
                  trustSlug={trustSlug}
                  request={request}
                  requestedDocuments={requestedDocuments}
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  This request is waiting for the prospect to confirm their email before you can review it.
                </p>
              )}
            </article>
          );
        })}
      </section>

      <section aria-labelledby="resolved-requests" className="grid gap-3">
        <h2 id="resolved-requests" className="text-lg font-medium">
          Resolved ({resolved.length})
        </h2>
        {resolved.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border p-4 text-sm">Nothing resolved yet.</p>
        ) : null}
        {resolved.map((request) => (
          <article key={request.id} className="grid gap-2 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">
                  {request.prospectName} · {request.prospectCompany}
                </p>
                <p className="text-muted-foreground text-sm">
                  {STATE_LABELS[request.state] ?? request.state} · {request.downloadCount} download
                  {request.downloadCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            {request.grants.length > 0 ? (
              <ul className="grid gap-1">
                {request.grants.map((grant) => (
                  <li key={grant.grantId} className="flex flex-wrap items-center gap-2 text-sm">
                    <span>{grant.documentTitle}</span>
                    <span className="text-muted-foreground text-xs">
                      {grant.state} · expires {formatDate(grant.expiresAt)}
                    </span>
                    {grant.state === "active" ? (
                      <ActionForm
                        orgSlug={orgSlug}
                        action={revokeGrantAction}
                        submitLabel="Revoke"
                        hidden={{ grantId: grant.grantId }}
                        variant="outline"
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </section>

      <p className="text-muted-foreground text-sm">
        Need to share the page?{" "}
        <Link href={`/app/${orgSlug}/trust-center`} className="underline">
          Open the Trust Center editor
        </Link>
        .
      </p>
    </div>
  );
}
