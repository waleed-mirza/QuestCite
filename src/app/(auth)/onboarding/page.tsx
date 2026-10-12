import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { OrganizationForm } from "@/features/onboarding/components/organization-form";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUser } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Create your workspace",
};

/**
 * /onboarding doubles as the workspace router (journey J1 re-entry, decided
 * W2): a verified user with at least one membership lands straight in their
 * oldest workspace; a verified user without one sees the creation form. The
 * proxy sends authenticated users here from auth forms and login redirects.
 * `?new=1` skips the router so members can create an additional workspace
 * (org switcher's "New workspace" action).
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const user = await getUser();
  if (user === null) {
    redirect("/login");
  }

  const { new: newWorkspace } = await searchParams;
  if (newWorkspace !== "1") {
    const supabase = await createSupabaseServerClient();
    const { data: rows, error } = await supabase
      .from("organization_members")
      .select("joined_at, organizations(slug)")
      .eq("user_id", user.userId)
      .order("joined_at", { ascending: true })
      .limit(1);

    if (error !== null) {
      // Fall through to the creation form — workspace access stays guarded by
      // requireOrgRole regardless.
      logger.warn("onboarding membership lookup failed", { code: error.message.slice(0, 60) });
    }

    const firstSlug = rows?.[0]?.organizations?.slug;
    if (typeof firstSlug === "string" && firstSlug !== "") {
      redirect(`/app/${firstSlug}`);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h1 className="text-xl leading-none font-semibold">Create your workspace</h1>
        <CardDescription>
          One workspace per company — you can invite your team once it&apos;s created.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <OrganizationForm />
      </CardContent>
    </Card>
  );
}
