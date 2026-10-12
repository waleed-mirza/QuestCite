import type { Metadata } from "next";
import Link from "next/link";

import { TermsAcceptForm } from "@/features/trust-center/components/terms-accept-form";
import { getProspectDocuments } from "@/server/services/trust-public";

/**
 * The prospect's gated page (J9 step 3-5): granted documents, short-lived
 * downloads, clickwrap re-acceptance when terms changed. Invalid and expired
 * links get distinct, safe states (wireframe §6 "expired/invalid download
 * link page") — neither names documents or confirms guesses.
 */

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Your documents", robots: { index: false, follow: false } };
}

export default async function ProspectAccessPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const view = await getProspectDocuments(slug, token);

  if (view.status === "invalid") {
    return (
      <main className="mx-auto grid w-full max-w-xl gap-3 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">This link isn&apos;t valid</h1>
        <p className="text-muted-foreground text-sm">
          Access links work only for the request they were issued for. If you reached this page from an email,
          double-check the link, or request access again.
        </p>
        <Link href={`/trust/${slug}/request`} className="text-sm underline">
          Request access
        </Link>
      </main>
    );
  }

  if (view.status === "expired") {
    return (
      <main className="mx-auto grid w-full max-w-xl gap-3 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">This access has expired</h1>
        <p className="text-muted-foreground text-sm">
          Grants are time-limited. Request access again and we&apos;ll review it promptly.
        </p>
        <Link href={`/trust/${slug}/request`} className="text-sm underline">
          Request access again
        </Link>
      </main>
    );
  }

  const { data } = view;

  return (
    <main className="mx-auto grid w-full max-w-2xl gap-6 px-4 py-10">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Your documents{data.displayName === null ? "" : ` from ${data.displayName}`}
        </h1>
        <p className="text-muted-foreground text-sm">
          Download links are short-lived and scoped to the documents granted to you.
        </p>
      </header>

      {!data.termsCurrent ? (
        <TermsAcceptForm
          slug={slug}
          rawToken={token}
          termsVersion={data.termsVersion}
          termsText={data.termsText}
        />
      ) : null}

      {data.documents.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm">
          No active grants right now — the granted access may have been revoked or expired.{" "}
          <Link href={`/trust/${slug}/request`} className="underline">
            Request access
          </Link>
        </p>
      ) : (
        <ul className="grid gap-3">
          {data.documents.map((doc) => (
            <li key={doc.documentId} className="grid content-start gap-1 rounded-lg border p-4">
              <p className="font-medium">{doc.title}</p>
              <p className="text-muted-foreground text-sm">{doc.description}</p>
              <p className="text-muted-foreground text-xs">
                {doc.filename} · {formatBytes(doc.byteSize)} · access until{" "}
                {new Date(doc.expiresAt).toLocaleDateString()}
              </p>
              <a
                href={`/api/trust/${slug}/documents/${doc.documentId}/download?token=${encodeURIComponent(token)}`}
                download={doc.filename}
                className="inline-flex h-9 w-fit items-center rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700"
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
