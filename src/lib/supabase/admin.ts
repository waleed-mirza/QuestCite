import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

/**
 * Server-only service-role client. This bypasses RLS BY DESIGN and is
 * therefore restricted to one pattern (W7): signing a private storage object
 * AFTER the trust-access RPC has already validated the grant — the same
 * authorization split as questionnaire export downloads, where the anon/auth
 * path cannot sign another tenant's object. The key is never sent to the
 * browser (server-only import; W2 bundle check covers it) and is required in
 * production (check-env).
 *
 * If the key is not configured (bare dev setup), callers fail with
 * SERVICE_CLIENT_UNCONFIGURED — never a fallback to the anon key.
 */
export function createSupabaseAdminClient(): SupabaseClient<Database> {
  const env = getServerEnv();
  if (env.NEXT_PUBLIC_SUPABASE_URL === undefined || env.SUPABASE_SERVICE_ROLE_KEY === undefined) {
    throw new Error("SERVICE_CLIENT_UNCONFIGURED");
  }
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
