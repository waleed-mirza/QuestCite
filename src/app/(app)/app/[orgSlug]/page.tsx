import Link from "next/link";
import { Users } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requireOrg } from "@/server/authorization/org";

/**
 * Workspace overview. Week 2 ships identity/tenancy, so the overview is
 * deliberately a directory surface — feature data arrives with the weeks that
 * build those features (knowledge W3, questionnaires W4, …).
 */
export default async function OrgOverviewPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrg(orgSlug);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">{ctx.organization.name}</h1>
      <p className="text-muted-foreground mt-1">Workspace overview — you are signed in as {ctx.role}.</p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-2xl font-semibold">—</CardTitle>
            <CardDescription>Knowledge documents</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-2xl font-semibold">—</CardTitle>
            <CardDescription>Questionnaires</CardDescription>
          </CardHeader>
        </Card>
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-muted-foreground text-2xl font-semibold">—</CardTitle>
            <CardDescription>Trust Center</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto">
            <Button render={<Link href={`/app/${orgSlug}/members`} />} variant="outline" size="sm">
              <Users aria-hidden="true" />
              Manage members
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
