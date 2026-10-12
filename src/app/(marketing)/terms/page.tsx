import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { projectConfig } from "@/config/project";

export const metadata: Metadata = {
  title: "Terms",
  description: "QuestCite terms and MIT License summary from WHH Treasures.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 lg:py-20">
      <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">Project terms</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">Terms and license</h1>
      <p className="text-muted-foreground mt-4">
        Last updated October 12, 2026. {projectConfig.legalName} publishes this project under the MIT License.
        This page summarizes how to use the public demo and the source. It is not a substitute for the license text.
      </p>
      <div className="mt-10 space-y-6">
        <Card>
          <CardHeader><CardTitle>Public demo</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              The demo contains fictional sample data, is provided for evaluation, and may change or be withdrawn.
              It does not permit uploads, live AI, billing, or Resend application notifications and must not be used
              for real customer data or as compliance evidence.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>MIT License</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              The source is licensed under the MIT License. You may use, copy, modify, merge, publish, distribute,
              sublicense, and sell copies of the software. Keep the copyright and permission notice in substantial
              portions. The software is provided as-is, without warranty. The full text is in the repository LICENSE file.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Self-hosted responsibilities</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              You operate your infrastructure, credentials, providers, backups, access, retention, and legal or
              compliance decisions. Third-party services have their own terms and charges. Optional providers such as
              Resend are configured by each operator and are not included in the public demo.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Human review and no professional advice</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              QuestCite organizes evidence and creates draft output; it is not legal, audit, security, privacy, or
              compliance advice or certification. A qualified human must validate every answer, citation,
              representation, and export before external use.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>No warranty and contact</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              The source is MIT-licensed with no paid support contract. Questions may be sent to{" "}
              <a className="text-foreground underline underline-offset-4" href={projectConfig.supportHref}>
                {projectConfig.supportEmail}
              </a>
              . This summary is not legal advice.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
