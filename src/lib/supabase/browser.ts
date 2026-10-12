"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/types/database.types";

/**
 * Browser Supabase client (plan §7 session pattern). Publishable key only —
 * the service-role key must never appear in a browser bundle (Week 2 gate).
 * A single GoTrue instance per tab: repeated createBrowserClient calls would
 * register duplicate listeners and fight over the session.
 */

let client: SupabaseClient<Database> | undefined;

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (client !== undefined) {
    return client;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined || url === "" || key === undefined || key === "") {
    throw new Error(
      "Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing) — see docs/setup-supabase.md",
    );
  }

  client = createBrowserClient<Database>(url, key);
  return client;
}
