import type { Metadata } from "next";
import Link from "next/link";

import { confirmAccessRequest } from "@/server/services/trust-public";
import { verifyAccessVerificationToken } from "@/lib/security/verify-token";

/**
 * Email-verification landing for access requests (D029, PRD §7.4
 * submitted → pending_review). The token is a stateless HMAC over the request
 * id + expiry; only after it verifies does the idempotent confirm RPC run.
 * Generic copy on every failure — no request existence leak.
 */

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Confirm your request", robots: { index: false, follow: false } };
}

export default async function VerifyRequestPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const verified = verifyAccessVerificationToken(token);
  if (verified !== null) {
    await confirmAccessRequest(verified.requestId);
  }

  return (
    <main className="mx-auto grid w-full max-w-xl gap-3 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        {verified === null ? "This link isn't valid anymore" : "Email confirmed"}
      </h1>
      <p className="text-muted-foreground text-sm">
        {verified === null
          ? "Verification links expire after 24 hours. Submit your request again."
          : "Your request is now with the team for review. We'll email you the outcome."}
      </p>
      <Link href={`/trust/${slug}`} className="text-sm underline">
        Back to the Trust Center
      </Link>
    </main>
  );
}
