import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sellerConfig } from "@/config/seller";

export const metadata: Metadata = {
  title: "Privacy",
  description: "Privacy notice for the QuestCite public demo operated by WHH Treasures.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 lg:py-20">
      <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">Privacy notice</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">Privacy notice</h1>
      <p className="text-muted-foreground mt-4">
        Last updated October 12, 2026. This notice covers the public QuestCite demo operated by{" "}
        {sellerConfig.legalName}. Each operator must publish a notice for its own deployment and actual data
        practices.
      </p>
      <div className="mt-10 space-y-6">
        <Card>
          <CardHeader><CardTitle>Who operates this demo?</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              {sellerConfig.legalName} publishes the QuestCite marketing site and fictional, read-only demo. Contact
              us at{" "}
              <a className="text-foreground underline underline-offset-4" href={sellerConfig.supportHref}>
                {sellerConfig.supportEmail}
              </a>{" "}
              with a privacy question about this site.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>What this site processes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              The demo replays fictional sample content and does not enable document uploads, billing, live AI, or
              Resend application notifications. If a visitor creates an account, Supabase processes the account and
              session details needed for authentication and may deliver account messages. Netlify and Supabase may
              also process routine request information such as IP address, browser details, timestamps, and security
              logs to deliver and protect the site.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Self-hosted deployments</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              QuestCite is self-hosted. Each operator controls its own deployment and is responsible for disclosing
              its identity, purposes, data categories, legal basis, processors, region, retention, security, cookies,
              and rights-request process. A configured deployment may process account identity, documents,
              questionnaires, answers, review activity, access requests, notifications, and audit metadata.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Providers, retention, and rights</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              The deployment operator selects and contracts with its hosting, Supabase, optional AI, email, and
              billing providers. It must collect only what it needs, set retention and deletion rules, secure access,
              and respond to applicable privacy rights. For this public site, email {sellerConfig.supportEmail};
              rights and available remedies depend on applicable law.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
