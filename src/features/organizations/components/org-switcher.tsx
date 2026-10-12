import Link from "next/link";
import { ChevronsUpDown, Plus } from "lucide-react";

import type { Membership } from "@/features/organizations/memberships";

/**
 * Workspace switcher (journey J2): native <details> dropdown — keyboard and
 * screen-reader friendly with zero client JS. Navigating to another slug IS
 * the switch; the target layout revalidates membership server-side.
 */
export function OrgSwitcher({ memberships, currentSlug }: { memberships: Membership[]; currentSlug: string }) {
  const current = memberships.find((membership) => membership.slug === currentSlug);

  return (
    <details className="group relative">
      <summary
        className="hover:bg-sidebar-accent flex w-full cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`Switch workspace (current: ${current?.name ?? currentSlug})`}
      >
        <span className="truncate">{current?.name ?? currentSlug}</span>
        <ChevronsUpDown aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
      </summary>
      <div className="bg-popover text-popover-foreground border-border absolute left-0 z-10 mt-1 w-64 rounded-lg border p-1 shadow-md">
        <p className="text-muted-foreground px-3 py-1.5 text-xs font-medium">Workspaces</p>
        <ul>
          {memberships.map((membership) => (
            <li key={membership.organizationId}>
              <Link
                href={`/app/${membership.slug}`}
                aria-current={membership.slug === currentSlug ? "true" : undefined}
                className="hover:bg-sidebar-accent flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm"
              >
                <span className="truncate">{membership.name}</span>
                <span className="text-muted-foreground text-xs capitalize">{membership.role}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-border/60 mt-1 border-t pt-1">
          <Link
            href="/onboarding?new=1"
            className="hover:bg-sidebar-accent flex items-center gap-2 rounded-md px-3 py-2 text-sm"
          >
            <Plus aria-hidden="true" className="size-4" />
            New workspace
          </Link>
        </div>
      </div>
    </details>
  );
}
