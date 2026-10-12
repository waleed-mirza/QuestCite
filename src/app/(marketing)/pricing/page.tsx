import type { Metadata } from "next";
import Link from "next/link";

import { sellerConfig } from "@/config/seller";
import { LicenseCatalog } from "@/components/license-catalog";
import { PurchaseProof } from "@/components/purchase-proof";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Pricing",
  description: "QuestCite is free, MIT-licensed source from WHH Treasures. You self-host it.",
};

export default function PricingPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">MIT License</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">QuestCite is open source</h1>
        <p className="text-muted-foreground mt-5 text-lg text-pretty">
          The source is free under the MIT License. Clone it from GitHub and self-host it. Hosting,
          provider accounts, uptime, and compliance certification are not included.
        </p>
      </div>

      <div className="mt-12">
        <LicenseCatalog showHeading={false} />
      </div>

      <div className="mt-12">
        <PurchaseProof />
      </div>

      <Card className="mt-10 bg-muted/40">
        <CardHeader>
          <CardTitle>After you clone it</CardTitle>
          <CardDescription>
            Follow the quickstart to run it locally, then deploy it yourself. This is the source, not a
            hosted QuestCite account.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-sm">
            Read the license and terms summary. Questions: {sellerConfig.supportEmail}.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/demo" className={buttonVariants({ variant: "outline" })}>Try the demo</Link>
            <Link href="/terms" className={buttonVariants({ variant: "outline" })}>Read terms summary</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
