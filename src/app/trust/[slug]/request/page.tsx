import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { RequestForm } from "@/features/trust-center/components/request-form";
import { getPublicTrustCenter } from "@/server/services/trust-public";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `Request document access · ${slug}`,
    robots: { index: false, follow: true },
  };
}

/** Access-request form (J8): anonymous, on a published center only. */
export default async function RequestAccessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getPublicTrustCenter(slug);
  if (data === null) {
    notFound();
  }

  return (
    <main className="mx-auto grid w-full max-w-xl gap-6 px-4 py-10">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Request document access</h1>
        <p className="text-muted-foreground text-sm">
          {data.displayName ?? data.slug} reviews every request before any document is shared.
        </p>
      </header>
      {data.documents.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm">
          There are no requestable documents right now.{" "}
          <Link href={`/trust/${slug}`} className="underline">
            Back to the Trust Center
          </Link>
        </p>
      ) : (
        <Suspense fallback={null}>
          <RequestForm slug={slug} data={data} />
        </Suspense>
      )}
    </main>
  );
}
