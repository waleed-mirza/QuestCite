import { ShieldX } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

/**
 * Permission-denied state (AGENTS.md rule 11): rendered in place when the
 * user can see a workspace but their role does not allow the section.
 */
export function AccessDenied({ what }: { what: string }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldX aria-hidden="true" className="text-destructive size-5" />
          You don&apos;t have access to {what}
        </h2>
        <CardDescription>
          This section is limited to workspaces owners and admins. Ask one of them for access if
          you need it.
        </CardDescription>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
