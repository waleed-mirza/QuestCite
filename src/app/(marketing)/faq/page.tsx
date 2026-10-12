import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sellerConfig } from "@/config/seller";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers about QuestCite hosting, evidence, AI drafting, data boundaries, and support.",
};

const QUESTIONS = [
  ["Is QuestCite hosted?", "No. It is a self-hosted Next.js and Supabase application. You operate the deployment and provider accounts."],
  ["How do I get the source?", "Clone the public GitHub repository. QuestCite is free under the MIT License. WHH Treasures does not sell the source or hosted accounts."],
  ["Does the public demo send data to an AI provider?", "No. The fictional Northstar Cloud demo replays stored results locally. Upload, billing, email, deletion, and live AI actions are disabled."],
  ["Can AI approve an answer?", "No. AI produces a draft disposition only. Human review and approval remain required before export or external use."],
  ["What questionnaire files are supported?", "XLSX and CSV imports are supported, with documented size and cell limits. The original workbook is kept untouched for verified export."],
  ["Where does customer data live?", "In the Supabase project you select and operate. Configure region, backups, retention, access, and provider contracts for your obligations."],
  ["Does QuestCite provide a compliance certification?", "No. It is workflow software, not an audit opinion, certification, legal advice, or compliance guarantee. Every answer and citation needs qualified human validation."],
  ["What does support include?", `The repository includes documentation and reproducible checks. Email ${sellerConfig.supportEmail} for product or security reports. There is no paid support plan or response-time guarantee.`],
] as const;

export default function FaqPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-14 sm:px-6 lg:py-20">
      <div className="text-center">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">Frequently asked questions</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Honest answers before you deploy</h1>
      </div>
      <div className="mt-12 space-y-4">
        {QUESTIONS.map(([question, answer]) => (
          <Card key={question}>
            <CardHeader><CardTitle className="text-lg">{question}</CardTitle></CardHeader>
            <CardContent><p className="text-muted-foreground">{answer}</p></CardContent>
          </Card>
        ))}
      </div>
      <p className="text-muted-foreground mt-10 text-center text-sm">
        Need the implementation details? Read the <Link className="text-foreground underline underline-offset-4" href="/docs">documentation overview</Link>.
      </p>
    </div>
  );
}
