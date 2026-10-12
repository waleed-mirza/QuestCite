import Link from "next/link";
import { BookOpen, FileSpreadsheet, ShieldCheck, Wrench } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** What a clone of the open-source repository contains. */
export function PurchaseProof() {
  return (
    <section aria-labelledby="source-handoff-heading">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">Self-hosted</p>
        <h2 id="source-handoff-heading" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          What you get from the repository
        </h2>
        <p className="text-muted-foreground mt-4 text-base text-pretty sm:text-lg">
          The MIT-licensed source. Clone it, install it, and deploy it in infrastructure you control.
          It is not a hosted QuestCite account.
        </p>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <FileSpreadsheet aria-hidden="true" className="text-primary mb-2 size-6" />
            <CardTitle>In the repository</CardTitle>
            <CardDescription>Application source and the operating materials needed to make it yours.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <pre className="bg-muted overflow-x-auto rounded-lg p-4 text-xs leading-6">
              <code>{"src/                  Next.js application source\nsupabase/migrations/  database schema and RLS policies\ntests/                unit, browser, and accessibility checks\ndocs/ and scripts/    setup, deployment, and demo guides"}</code>
            </pre>
            <p className="text-muted-foreground text-sm">
              Also included: generated database types, fictional demo data, workbook fixtures, and release checks.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Wrench aria-hidden="true" className="text-primary mb-2 size-6" />
            <CardTitle>Setup preview</CardTitle>
            <CardDescription>Start locally with the provider-free, signed-out demo before connecting services.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <pre className="bg-muted overflow-x-auto rounded-lg p-4 text-xs leading-6">
              <code>{"pnpm install --frozen-lockfile\ncp .env.example .env.local\npnpm check-env\npnpm dev"}</code>
            </pre>
            <p className="text-muted-foreground text-sm">
              When you are ready for authenticated features, configure Supabase, apply the documented migrations,
              and follow the production deployment guide.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <ShieldCheck aria-hidden="true" className="text-primary mb-2 size-6" />
            <CardTitle>You provide the hosting</CardTitle>
            <CardDescription>The license grants the code. You operate the deployment.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="font-medium">Runtime</dt>
                <dd className="text-muted-foreground mt-1">Node 24 LTS and pnpm 10.</dd>
              </div>
              <div>
                <dt className="font-medium">Production infrastructure</dt>
                <dd className="text-muted-foreground mt-1">A Next.js host and a Supabase project for Postgres, Auth, and Storage.</dd>
              </div>
              <div>
                <dt className="font-medium">Operator responsibilities</dt>
                <dd className="text-muted-foreground mt-1">Your domain, environment values, provider accounts, backups, retention, and access decisions.</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <BookOpen aria-hidden="true" className="text-primary mb-2 size-6" />
            <CardTitle>Support scope</CardTitle>
            <CardDescription>The repository is the support boundary.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Documentation and reproducible test commands ship with the source. Report defects against the
              repository version. Managed hosting, provider accounts, and a response-time service level are not
              included.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="bg-muted/40 mt-6 flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          Want product proof first? Take the provider-free, signed-out tour with fictional Northstar Cloud data.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/demo" className={buttonVariants({ variant: "outline" })}>Take the signed-out tour</Link>
          <Link href="/docs" className={buttonVariants({ variant: "outline" })}>Read setup docs</Link>
        </div>
      </div>
    </section>
  );
}
