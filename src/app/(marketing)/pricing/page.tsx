import type { Metadata } from "next";
import Link from "next/link";

import { projectConfig } from "@/config/project";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Open source",
  description: "QuestCite is free, MIT-licensed source from WHH Treasures. You self-host it.",
};

export default function PricingPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 lg:py-20">
      <div className="text-center">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">MIT License</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">QuestCite is open source</h1>
        <p className="text-muted-foreground mt-5 text-lg text-pretty">
          Clone the repository from GitHub and self-host it. There is no source fee. Hosting,
          provider accounts, uptime, and compliance certification are not included.
        </p>
      </div>

      <div className="mt-12 grid gap-8 text-left">
        <section>
          <h2 className="text-xl font-semibold tracking-tight">What the license covers</h2>
          <p className="text-muted-foreground mt-3 text-sm text-pretty">
            Use, modify, and distribute QuestCite under the MIT License, including in commercial
            products. Keep the copyright and permission notice in substantial portions of the software.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold tracking-tight">What you operate</h2>
          <p className="text-muted-foreground mt-3 text-sm text-pretty">
            You run Node 24, pnpm 10, a Next.js host, and a Supabase project. OpenAI, Resend, and
            Lemon Squeezy workspace billing are optional and configured only when you need them.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold tracking-tight">After you clone it</h2>
          <p className="text-muted-foreground mt-3 text-sm text-pretty">
            Follow the quickstart to run locally, then deploy yourself. This is the source, not a
            hosted QuestCite account. Questions: {projectConfig.supportEmail}.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <a
              href={projectConfig.repositoryUrl}
              rel="noreferrer"
              className={buttonVariants({ size: "lg" })}
            >
              View source on GitHub
            </a>
            <Link href="/demo" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Try the demo
            </Link>
            <Link href="/terms" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Read terms summary
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
