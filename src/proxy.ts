import { createServerClient, serializeCookieHeader, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getServerEnv } from "@/lib/env";

/**
 * Request proxy (Next 16 successor of middleware — plan §7 "auth-token refresh
 * proxy"). Responsibilities are deliberately narrow:
 *
 * 1. Refresh expired auth tokens once per navigation (getClaims) so routes
 *    render with a valid session; rotated cookies ride the response.
 * 2. Optimistic redirects for clearly-mismatched states: anonymous users are
 *    bounced from app/onboarding surfaces; signed-in users skip the auth forms.
 *
 * It is NOT an authorization layer: Server Functions bypass proxy matching, so
 * every page and action enforces auth itself via requireUser/requireOrgRole,
 * with RLS as the final enforcement layer (plan §7).
 */

const AUTH_FORM_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password"] as const;

function isAuthFormPath(pathname: string): boolean {
  return AUTH_FORM_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isProtectedPath(pathname: string): boolean {
  return pathname === "/onboarding" || pathname === "/app" || pathname.startsWith("/app/");
}

export const proxy = async (request: NextRequest): Promise<NextResponse> => {
  const env = getServerEnv();
  if (env.NEXT_PUBLIC_SUPABASE_URL === undefined || env.NEXT_PUBLIC_SUPABASE_ANON_KEY === undefined) {
    // Nothing to refresh — let routing proceed; server pages fail loudly with
    // the configured-error message from the client factory.
    return NextResponse.next();
  }

  const baseResponse = NextResponse.next({ request });

  // Rotated cookies must ride EVERY possible outcome — including redirects —
  // so they are collected here and stamped on before returning.
  const pendingCookies: Array<{ name: string; value: string; options?: CookieOptions }> = [];

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        pendingCookies.push(...cookiesToSet);
      },
    },
  });

  const finalize = (response: NextResponse): NextResponse => {
    for (const { name, value, options } of pendingCookies) {
      // Serialize with the library's own writer so cookie attribute handling
      // (chunk names, SameSite, expiry) matches what produced them.
      response.headers.append("set-cookie", serializeCookieHeader(name, value, options ?? {}));
    }
    return response;
  };

  // Refresh path: verifying claims touches the auth server only when the
  // access token is expired or missing. A verification error means "not
  // authenticated" — fail closed.
  const { data, error } = await supabase.auth.getClaims();
  const isAuthenticated = error === null && (data?.claims ?? null) !== null;

  const { pathname, search } = request.nextUrl;

  if (!isAuthenticated && isProtectedPath(pathname)) {
    const redirectTo = encodeURIComponent(`${pathname}${search}`);
    return finalize(NextResponse.redirect(new URL(`/login?redirectTo=${redirectTo}`, request.url)));
  }

  if (isAuthenticated && isAuthFormPath(pathname)) {
    // /onboarding doubles as the workspace router: members land in their org,
    // verified users without a workspace continue onboarding (J1).
    return finalize(NextResponse.redirect(new URL("/onboarding", request.url)));
  }

  return finalize(baseResponse);
};

export const config = {
  // Everything except API handlers, Next internals, and metadata assets.
  matcher: "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
};
