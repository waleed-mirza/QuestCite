import type { Metadata } from "next";
import Link from "next/link";

import { ArrowRight, BookOpen, ShieldCheck, Wrench } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Documentation",
  description: "QuestCite setup, deployment, security, data-flow, and customization documentation.",
};

const GUIDES = [
  { icon: BookOpen, title: "Quickstart", body: "Install with Node 24 and pnpm 10, run the provider-free demo, and provision the fictional seed when Supabase is configured." },
  { icon: Wrench, title: "Deployment", body: "Configure Supabase, Vercel, auth callbacks, optional AI and email, backups, and production smoke checks." },
  { icon: ShieldCheck, title: "Security and data flow", body: "Review tenant isolation, private storage, RLS, signed downloads, webhook boundaries, logging rules, and demo protections." },
] as const;

export default function DocsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
      <div className="max-w-3xl">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">Documentation</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Understand the boundary before you deploy</h1>
        <p className="text-muted-foreground mt-5 text-lg">
          The repository includes the complete operational guides. Start with the quickstart, then review deployment,
          supported files, security, and customization before accepting real data.
        </p>
      </div>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {GUIDES.map(({ icon: Icon, title, body }) => (
          <Card key={title}>
            <CardHeader>
              <Icon aria-hidden="true" className="text-primary mb-2 size-6" />
              <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent><p className="text-muted-foreground">{body}</p></CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-8">
        <CardHeader><CardTitle>Recommended reading order</CardTitle></CardHeader>
        <CardContent>
          <ol className="text-muted-foreground grid gap-3 text-sm sm:grid-cols-2">
            <li><span className="text-foreground font-medium">1. Quickstart</span> — install and run the safe demo.</li>
            <li><span className="text-foreground font-medium">2. Supported files</span> — confirm limits and round-trip behavior.</li>
            <li><span className="text-foreground font-medium">3. Deployment</span> — configure production infrastructure.</li>
            <li><span className="text-foreground font-medium">4. Security</span> — review RLS, keys, logs, and provider boundaries.</li>
          </ol>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link className="text-primary inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline" href="/demo">Open the demo <ArrowRight aria-hidden="true" className="size-4" /></Link>
            <Link className="text-primary inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline" href="/faq">Read the FAQ <ArrowRight aria-hidden="true" className="size-4" /></Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
