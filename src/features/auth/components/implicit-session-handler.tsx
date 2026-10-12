"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Consumes Supabase implicit-flow links (`#access_token=…` fragments, used by
 * admin-generated links) that land on auth pages. The PKCE `?code=` path is
 * handled server-side in /auth/callback; this covers the fragment variant by
 * letting the browser client detect and store the session, then continuing to
 * the workspace router. With no session, the page stays as-is.
 */
export function ImplicitSessionHandler() {
  const router = useRouter();

  useEffect(() => {
    if (!window.location.hash.includes("access_token=")) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      // The app uses the PKCE flow for real email links; implicit fragments
      // arrive only from admin-generated links. setSession validates the
      // pair against the auth server before storing it in cookies.
      if (accessToken === null || refreshToken === null) {
        return;
      }
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (cancelled) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      router.replace(error === null ? "/onboarding" : "/login?error=verification_failed");
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
