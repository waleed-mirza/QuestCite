import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { appConfig } from "@/config/app";
import { sellerConfig } from "@/config/seller";
import { SourceLink } from "@/components/storefront-buy-link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#open-source", label: "Open source" },
  { href: "/faq", label: "FAQ" },
  { href: "/docs", label: "Docs" },
  { href: "/login", label: "Sign in" },
] as const;

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-border/60 border-b">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold" aria-label={`${appConfig.name} home`}>
            <ShieldCheck aria-hidden="true" className="text-primary size-5" />
            <span>{appConfig.name}</span>
          </Link>
          <nav aria-label="Main navigation" className="hidden items-center gap-6 text-sm sm:flex">
            {NAV_LINKS.slice(0, 5).map((link) => (
              <Link key={link.href} href={link.href} className="text-muted-foreground hover:text-foreground transition-colors">
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:inline-flex")}>
              Sign in
            </Link>
            <SourceLink className={buttonVariants({ size: "sm" })}>Source</SourceLink>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        {children}
      </main>

      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} {sellerConfig.legalName}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Link href="/pricing" className="hover:text-foreground transition-colors">Open source</Link>
            <Link href="/faq" className="hover:text-foreground transition-colors">FAQ</Link>
            <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <a href={sellerConfig.supportHref} className="hover:text-foreground transition-colors">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
