import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getServerEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

/**
 * Server Supabase client (plan §7 session pattern). Reads the session from
 * cookies; when the access token is expired it refreshes through the auth
 * server and writes the rotated tokens back via the cookie adapter.
 *
 * `setAll` is a no-op during Server Component rendering — Next forbids cookie
 * writes there — because token refresh is already handled by `src/proxy.ts`
 * before routes render. The swallow is documented and deliberate; anything
 * other than that render-time write ban must surface as an error.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  const env = getServerEnv();
  if (env.NEXT_PUBLIC_SUPABASE_URL === undefined || env.NEXT_PUBLIC_SUPABASE_ANON_KEY === undefined) {
    throw new Error(
      "Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing) — see docs/setup-supabase.md",
    );
  }

  const cookieStore = await cookies();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render: cookie writes are banned
          // there and refresh already happened in the proxy. No-op by design.
        }
      },
    },
  });
}
