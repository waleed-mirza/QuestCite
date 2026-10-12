import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { BrandingForm } from "@/features/trust-center/components/branding-form";
import { CertificationManager } from "@/features/trust-center/components/certification-manager";
import { DocumentCardsManager } from "@/features/trust-center/components/document-cards-manager";
import { FaqManager } from "@/features/trust-center/components/faq-manager";
import { StatusForm } from "@/features/trust-center/components/status-form";
import { SubprocessorManager } from "@/features/trust-center/components/subprocessor-manager";
import { TrustSlugForm } from "@/features/trust-center/components/slug-form";
import { getTrustCenterEditorState } from "@/server/services/trust-center";
import { requireOrgRole } from "@/server/authorization/org";

/**
 * Trust Center editor (plan §W7): branding, clickwrap terms, content
 * sections with per-item visibility, requestable document cards, and the
 * draft/preview/published lifecycle. Owner/admin only (permission matrix);
 * RLS re-checks every write.
 */

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }): Promise<Metadata> {
  const { orgSlug } = await params;
  return { title: `Trust Center · ${orgSlug}` };
}

export default async function TrustCenterPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await requireOrgRole(["owner", "admin"], orgSlug);

  let state;
  try {
    state = await getTrustCenterEditorState(orgSlug);
  } catch {
    redirect(`/app/${orgSlug}`);
  }

  const publicUrl = `/trust/${state.trustCenter.slug}`;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trust Center</h1>
          <p className="text-muted-foreground text-sm">
            Your public security page and gated document requests.
          </p>
        </div>
        <Link
          href={publicUrl}
          className="border-border text-foreground hover:bg-accent inline-flex h-9 items-center gap-1 rounded-md border px-3 text-sm font-medium"
        >
          View public page <ExternalLink aria-hidden="true" className="size-4" />
        </Link>
      </header>

      <section aria-labelledby="tc-status" className="rounded-lg border p-4">
        <h2 id="tc-status" className="mb-3 text-lg font-medium">
          Status
        </h2>
        <StatusForm orgSlug={orgSlug} status={state.trustCenter.status} publicUrl={publicUrl} />
      </section>

      <section aria-labelledby="tc-branding" className="rounded-lg border p-4">
        <h2 id="tc-branding" className="mb-3 text-lg font-medium">
          Branding, contact &amp; terms
        </h2>
        <div className="grid gap-5">
          <TrustSlugForm orgSlug={orgSlug} currentSlug={state.trustCenter.slug} />
          <BrandingForm orgSlug={orgSlug} trustCenter={state.trustCenter} />
        </div>
      </section>

      <section aria-labelledby="tc-docs" className="rounded-lg border p-4">
        <h2 id="tc-docs" className="mb-1 text-lg font-medium">
          Requestable documents
        </h2>
        <p className="text-muted-foreground mb-3 text-sm">
          Cards appear publicly only when requestability is on AND the document is active with a processed version.
        </p>
        <DocumentCardsManager
          orgSlug={orgSlug}
          trustDocuments={state.trustDocuments}
          pickerDocuments={state.pickerDocuments}
        />
      </section>

      <section aria-labelledby="tc-faqs" className="rounded-lg border p-4">
        <h2 id="tc-faqs" className="mb-3 text-lg font-medium">
          FAQ
        </h2>
        <FaqManager orgSlug={orgSlug} faqs={state.faqs} />
      </section>

      <section aria-labelledby="tc-certs" className="rounded-lg border p-4">
        <h2 id="tc-certs" className="mb-3 text-lg font-medium">
          Certifications
        </h2>
        <CertificationManager orgSlug={orgSlug} certifications={state.certifications} />
      </section>

      <section aria-labelledby="tc-subs" className="rounded-lg border p-4">
        <h2 id="tc-subs" className="mb-3 text-lg font-medium">
          Subprocessors
        </h2>
        <SubprocessorManager orgSlug={orgSlug} subprocessors={state.subprocessors} />
      </section>
    </div>
  );
}
