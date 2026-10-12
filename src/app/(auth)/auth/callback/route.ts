import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Auth callback (journeys J1/J2 step 3): exchanges the PKCE `code` from
 * verification and recovery links for a session, then continues to `next`.
 *
 * `next` is constrained to same-origin paths so the link can never bounce a
 * session to an external origin (open-redirect guard).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/onboarding";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/onboarding";

  if (code !== null && code !== "") {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error === null) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // One generic failure surface — no distinction between expired, reused, or
  // wrong codes (plan §7, AGENTS.md rule 8).
  return NextResponse.redirect(new URL("/login?error=verification_failed", origin));
}
