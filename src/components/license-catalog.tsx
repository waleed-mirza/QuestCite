import { sellerConfig } from "@/config/seller";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function LicenseCatalog({ showHeading = true }: { showHeading?: boolean }) {
  return (
    <div>
      {showHeading ? (
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">Open source</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Free under the MIT License</h2>
          <p className="text-muted-foreground mt-4 text-base text-pretty sm:text-lg">
            Clone the repository, modify it, and self-host it. There is no source-code fee. You still
            pay your own hosting and provider accounts. Support: {sellerConfig.supportEmail}.
          </p>
        </div>
      ) : null}

      <ul
        aria-label="Open-source license"
        className={cn("grid items-stretch gap-6", showHeading ? "mt-10" : undefined)}
      >
        <li className="flex">
          <Card className="flex w-full flex-col ring-2 ring-primary">
            <CardHeader className="gap-3">
              <div className="flex items-start justify-between gap-3">
                {showHeading ? (
                  <h3 className="font-heading text-xl leading-snug font-semibold">MIT License</h3>
                ) : (
                  <h2 className="font-heading text-xl leading-snug font-semibold">MIT License</h2>
                )}
                <span className="text-muted-foreground shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium">
                  Open source
                </span>
              </div>
              <p className="text-4xl font-semibold tracking-tight">Free</p>
              <CardDescription>
                Use, modify, and distribute QuestCite, including in commercial products. Keep the copyright
                and permission notice.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-5">
              <dl className="grid gap-3 text-sm text-pretty">
                <div className="border-border/60 rounded-lg border px-3 py-2">
                  <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Best for</dt>
                  <dd className="mt-1">Teams that want to run questionnaire drafting on infrastructure they control.</dd>
                </div>
                <div className="border-border/60 rounded-lg border px-3 py-2">
                  <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">You operate</dt>
                  <dd className="mt-1">Hosting, Supabase, and any optional OpenAI, Resend, or billing provider you turn on.</dd>
                </div>
              </dl>
              <a
                href={sellerConfig.repositoryUrl}
                rel="noreferrer"
                className={cn(buttonVariants({ size: "lg" }), "mt-auto w-full")}
              >
                View source on GitHub
              </a>
            </CardContent>
          </Card>
        </li>
      </ul>
    </div>
  );
}
