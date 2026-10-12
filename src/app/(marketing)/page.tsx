import Link from "next/link";
import { FileSpreadsheet, BookOpen, MessageSquareText } from "lucide-react";

import { appConfig } from "@/config/app";
import { projectConfig } from "@/config/project";
import { SourceLink } from "@/components/source-link";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const FEATURES = [
  {
    icon: FileSpreadsheet,
    title: "Import XLSX or CSV questionnaires",
    description:
      "Bring supported Excel (.xlsx) or CSV files in, then export a verified workbook while preserving the source structure.",
  },
  {
    icon: BookOpen,
    title: "Your knowledge base",
    description:
      "Upload policies and security documents once. Every AI answer cites the exact source passage behind it.",
  },
  {
    icon: MessageSquareText,
    title: "Review workflow",
    description:
      "Draft, review, approve. Reviewers see inline citations and can reject with reasons before anything is exported.",
  },
] as const;

const STEPS = [
  { step: "01", title: "Import", body: "Drop in the prospect's .xlsx or .csv questionnaire, review the detected columns, and confirm the mapping." },
  { step: "02", title: "Draft", body: "Answers are drafted from your approved knowledge base with citations to source passages." },
  { step: "03", title: "Review", body: "Your team approves, edits, or rejects each answer — with a full audit trail." },
  { step: "04", title: "Export", body: "Export the completed workbook and share your public Trust Center link." },
] as const;

export default function LandingPage() {
  return (
    <div>
      <section className="border-border/60 border-b">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6 sm:py-28">
          <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
            Evidence-grounded questionnaire workflow
          </p>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">
            Answer security questionnaires in hours, not weeks
          </h1>
          <p className="text-muted-foreground max-w-2xl text-lg text-balance">
            {appConfig.name} drafts answers from your own trusted documents — every claim cited, every
            change reviewed, every export ready to send.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <SourceLink className={buttonVariants({ size: "lg" })}>
              View on GitHub
            </SourceLink>
            <Link href="/demo" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Try the demo
            </Link>
          </div>
          <p className="text-muted-foreground text-sm font-medium">
            MIT-licensed source. You install and host it.
          </p>
        </div>
      </section>

      <section id="features" className="scroll-mt-20">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <h2 className="text-center text-3xl font-semibold tracking-tight">Everything the workflow needs</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <Card key={feature.title}>
                <CardHeader>
                  <div className="bg-primary/10 text-primary mb-2 flex size-10 items-center justify-center rounded-lg">
                    <feature.icon aria-hidden="true" className="size-5" />
                  </div>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                  <CardDescription>{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="bg-muted/40 scroll-mt-20 border-y">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <h2 className="mt-0 text-center text-3xl font-semibold tracking-tight">From questionnaire to sent workbook</h2>
          <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((item) => (
              <li key={item.step} className="border-border/60 rounded-lg border bg-background p-6">
                <p className="text-primary text-sm font-semibold">{item.step}</p>
                <h3 className="mt-2 font-semibold">{item.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm">{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="open-source" className="scroll-mt-20">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
          <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">Open source</p>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Free under the MIT License</h2>
          <p className="text-muted-foreground text-base text-pretty sm:text-lg">
            Clone the repository, modify it, and self-host it. You operate hosting, Supabase, and any
            optional OpenAI, Resend, or billing provider you turn on. Support: {projectConfig.supportEmail}.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href={projectConfig.repositoryUrl}
              rel="noreferrer"
              className={buttonVariants({ size: "lg" })}
            >
              View source on GitHub
            </a>
            <Link href="/pricing" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Self-host details
            </Link>
            <Link href="/demo" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Try the fictional demo
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
