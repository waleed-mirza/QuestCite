import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PublicTrustCenterView } from "@/features/trust-center/components/public-view";
import { getPublicTrustCenter } from "@/server/services/trust-public";

/**
 * The public Trust Center (journey J8, wireframe §6): anonymous,
 * server-rendered, allowlisted fields only. Unknown AND unpublished slugs are
 * the same 404 — no existence leak (plan §W7 gate).
 */

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublicTrustCenter(slug);
  if (data === null) {
    return { title: "Trust Center", robots: { index: false, follow: false } };
  }
  const description =
    data.heroSubtitle ?? (data.overview !== null ? data.overview.slice(0, 160) : `Security practices for ${data.displayName ?? data.slug}.`);
  return {
    title: `${data.displayName ?? data.slug} · Security & Trust Center`,
    description,
    robots: { index: true, follow: true },
    openGraph: {
      title: `${data.displayName ?? data.slug} Security & Trust Center`,
      description,
      siteName: data.displayName ?? data.slug,
      images: data.logoUrl !== null ? [{ url: data.logoUrl }] : undefined,
    },
  };
}

export default async function PublicTrustCenterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getPublicTrustCenter(slug);
  if (data === null) {
    notFound();
  }

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-8 px-4 py-10">
      <header className="grid gap-3">
        {data.logoUrl !== null ? (
          <Image src={data.logoUrl} alt={`${data.displayName ?? data.slug} logo`} width={48} height={48} className="rounded-md" unoptimized />
        ) : null}
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{data.heroTitle ?? "Security & Trust Center"}</h1>
          {data.heroSubtitle !== null ? <p className="text-muted-foreground mt-1">{data.heroSubtitle}</p> : null}
        </div>
      </header>
      <Suspense fallback={null}>
        <PublicTrustCenterView slug={slug} data={data} />
      </Suspense>
    </main>
  );
}
