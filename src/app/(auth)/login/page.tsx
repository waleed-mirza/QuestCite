import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { LoginForm } from "@/features/auth/components/login-form";
import { ImplicitSessionHandler } from "@/features/auth/components/implicit-session-handler";
import { getUser } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Sign in",
};

const AUTH_BANNER_MESSAGES: Record<string, string> = {
  // Verification/recovery links that failed to exchange — one generic message
  // for every failure kind so nothing about the account is revealed.
  verification_failed: "That link is invalid or has expired. Sign in, or request a new link.",
  recovery_required: "Your password reset link is invalid or has expired. Request a new one.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // The proxy already redirects authenticated users; this covers direct
  // renders so an authenticated visitor never sees the form.
  const user = await getUser();
  if (user !== null) {
    redirect("/onboarding");
  }

  const { error } = await searchParams;
  const banner = error !== undefined ? AUTH_BANNER_MESSAGES[error] : undefined;

  return (
    <>
      <ImplicitSessionHandler />
      <Card>
      <CardHeader>
        <h1 className="text-xl leading-none font-semibold">Sign in</h1>
        <CardDescription>Access your workspace and questionnaires.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {banner !== undefined ? (
          <p role="alert" className="text-destructive text-sm">
            {banner}
          </p>
        ) : null}
        <LoginForm />
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-muted-foreground text-sm">
          No account yet?{" "}
          <Link href="/signup" className="text-foreground font-medium underline-offset-4 hover:underline">
            Create a workspace
          </Link>
        </p>
      </CardFooter>
      </Card>
    </>
  );
}
