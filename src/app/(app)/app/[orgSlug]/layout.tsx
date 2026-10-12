import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Bell, BookOpen, ClipboardCheck, CreditCard, FileSpreadsheet, FileText, Globe, Inbox, LayoutDashboard, Settings, ShieldCheck, Users, type LucideIcon } from "lucide-react";

import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { OrgSwitcher } from "@/features/organizations/components/org-switcher";
import { listMemberships } from "@/features/organizations/memberships";
import { countMyUnread } from "@/features/notifications/server";
import { requireUser } from "@/server/auth/session";
import { appConfig } from "@/config/app";
import { guardOrg } from "@/server/authorization/guard";
import type { AppRole } from "@/server/authorization/org";

/**
 * Org-scoped shell (D015): everything under /app/[orgSlug] is tenant-scoped.
 * The layout guard is UX-only optimism — every page and action re-checks with
 * requireOrgRole, and RLS is the final enforcement layer (plan §7).
 */

type NavItem = {
  readonly segment: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly roles?: readonly AppRole[];
};

const NAV_ITEMS: readonly NavItem[] = [
  { segment: "", label: "Overview", icon: LayoutDashboard },
  { segment: "documents", label: "Documents", icon: FileText },
  { segment: "knowledge", label: "Knowledge entries", icon: BookOpen },
  { segment: "members", label: "Members", icon: Users },
  { segment: "questionnaires", label: "Questionnaires", icon: FileSpreadsheet },
  { segment: "review", label: "Review queue", icon: ClipboardCheck },
  { segment: "trust-center", label: "Trust Center", icon: Globe },
  { segment: "access-requests", label: "Access requests", icon: Inbox },
  { segment: "notifications", label: "Notifications", icon: Bell },
  { segment: "billing", label: "Billing", icon: CreditCard, roles: ["owner", "admin"] as const },
  { segment: "settings", label: "Settings", icon: Settings, roles: ["owner", "admin"] as const },
];

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }): Promise<Metadata> {
  const { orgSlug } = await params;
  return { title: `${orgSlug} workspace` };
}

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const guard = await guardOrg(orgSlug);
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      redirect(`/login?redirectTo=${encodeURIComponent(`/app/${orgSlug}`)}`);
    }
    notFound();
  }
  const ctx = guard.ctx;
  const memberships = await listMemberships();
  const user = await requireUser();
  const unreadNotifications = await countMyUnread(ctx.organization.id, user.userId);

  const hrefFor = (segment: string) => (segment === "" ? `/app/${orgSlug}` : `/app/${orgSlug}/${segment}`);

  return (
    <div className="flex min-h-svh flex-col sm:flex-row">
      <aside className="bg-sidebar border-sidebar-border w-full shrink-0 border-b sm:w-64 sm:border-b-0 sm:border-r">
        <div className="flex h-16 items-center gap-2 px-5 font-semibold">
          <ShieldCheck aria-hidden="true" className="text-sidebar-primary size-5" />
          <span className="truncate">{appConfig.name}</span>
        </div>
        <div className="px-3 pb-2">
          <OrgSwitcher memberships={memberships} currentSlug={orgSlug} />
        </div>
        <nav
          aria-label="Workspace navigation"
          className="flex gap-1 overflow-x-auto px-3 pb-3 sm:flex-col sm:overflow-visible sm:pb-0"
        >
          {NAV_ITEMS.filter((item) => canSeeNavItem(item, ctx.role)).map((item) => (
            <Link
              key={item.label}
              href={hrefFor(item.segment)}
              className="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap"
            >
              <item.icon aria-hidden="true" className="size-4" />
              {item.label}
              {item.segment === "notifications" && unreadNotifications > 0 ? (
                <span className="bg-blue-600 ml-auto rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-white">
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border/60 flex h-16 items-center justify-between gap-4 border-b px-4 sm:px-6">
          <p className="text-muted-foreground truncate text-sm">
            {ctx.organization.name} · <span className="capitalize">{ctx.role}</span>
          </p>
          <SignOutButton />
        </header>
        <main id="main-content" className="flex-1 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function canSeeNavItem(item: NavItem, role: AppRole): boolean {
  return item.roles === undefined || item.roles.find((allowedRole) => allowedRole === role) !== undefined;
}
