import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { acceptInviteAction } from "@/features/members/accept-actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUser } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Workspace invitation",
};

/**
 * Invitation landing (journey J2 step 3): shows the organization, inviter, and
 * granted role BEFORE acceptance. The preview RPC only returns data when the
 * signed-in user's email matches the invite — otherwise a single neutral
 * "invalid invitation" card, so nothing leaks about pending invites.
 */
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error: failed } = await searchParams;

  const user = await getUser();
  if (user === null) {
    redirect(`/login?redirectTo=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("preview_organization_invite", { p_raw_token: token });
  const preview = (data as Array<{
    organization_name: string;
    inviter_name: string;
    invited_role: "admin" | "reviewer" | "viewer";
    expires_at: string;
  }> | null)?.[0];

  const neutral = failed === "1" || preview === undefined;

  return (
    <Card>
      <CardHeader>
        <h1 className="text-xl leading-none font-semibold">Workspace invitation</h1>
        <CardDescription>
          {neutral
            ? "This invitation link is invalid, expired, or was not issued for the account you are signed in with."
            : "Review the details below before accepting."}
        </CardDescription>
      </CardHeader>
      {neutral ? (
        <CardFooter className="justify-center">
          <Button render={<Link href="/onboarding" />} variant="outline">
            Go to your workspaces
          </Button>
        </CardFooter>
      ) : (
        <>
          <CardContent>
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Workspace</dt>
                <dd className="font-medium">{preview?.organization_name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Invited by</dt>
                <dd className="font-medium">
                  {preview?.inviter_name !== undefined && preview?.inviter_name !== "" ? preview?.inviter_name : "A workspace manager"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Role granted</dt>
                <dd className="font-medium capitalize">{preview?.invited_role}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Signed in as</dt>
                <dd className="font-medium">{user?.email}</dd>
              </div>
            </dl>
          </CardContent>
          <CardFooter>
            <form action={acceptInviteAction.bind(null, token)} className="w-full">
              <Button type="submit" className="w-full">
                Accept invitation
              </Button>
            </form>
          </CardFooter>
        </>
      )}
    </Card>
  );
}
