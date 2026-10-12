/**
 * Fixture provisioning for the integration suite.
 *
 * Every helper registers what it creates; `disposeAll()` removes orgs (the
 * delete cascades to members/invites/audit/trust-center rows) and users (the
 * delete cascades to profiles/memberships). Service-role access is used for
 * provisioning only — assertions always run through real anon/authenticated
 * clients so RLS is what is actually under test.
 *
 * Emails carry a random run suffix so re-runs against the same hosted project
 * never collide (there is no local `db reset` in this repo — D016).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

import { CLIENT_OPTIONS, getAdminClient, publishableKey, supabaseUrl } from "./clients";

const RUN_SUFFIX = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const PASSWORD = "Int-Test-Only-2026!x";

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

export function testEmail(localPart: string): string {
  return `t2-${localPart}-${RUN_SUFFIX}@integration.invalid`;
}

export type TestUser = {
  userId: string;
  email: string;
};

/** Creates a confirmed auth user (no email sent — admin API, server-side). */
export async function createTestUser(
  localPart: string,
  options: { fullName?: string; confirmEmail?: boolean } = {},
): Promise<TestUser> {
  const admin = getAdminClient();
  const email = testEmail(localPart);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: options.confirmEmail ?? true,
    user_metadata: { full_name: options.fullName ?? localPart },
  });
  if (error !== null || data.user === null) {
    throw new Error(`createUser(${localPart}) failed: ${error?.message ?? "no user returned"}`);
  }
  createdUserIds.push(data.user.id);
  return { userId: data.user.id, email };
}

/** Password sign-in through the public API — a real session, like the app. */
export async function signInAs(user: TestUser): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(supabaseUrl(), publishableKey(), CLIENT_OPTIONS);
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  if (error !== null) {
    throw new Error(`signInAs(${user.email}) failed: ${error.message}`);
  }
  return client;
}

/**
 * Owner-side happy path: create_organization_with_owner through a session.
 *
 * Legacy integration fixtures default to a test-only Starter subscription so
 * their data-volume/RLS assertions do not collide with Week 8 Trial limits.
 * Billing-specific tests pass `{ plan: "trial" }` to exercise the real default.
 */
export async function createOrgAs(
  owner: SupabaseClient<Database>,
  name: string,
  slug: string,
  options: { plan?: "trial" | "starter" } = {},
): Promise<string> {
  const { data, error } = await owner.rpc("create_organization_with_owner", { p_name: name, p_slug: slug });
  if (error !== null || data === null) {
    throw new Error(`createOrgAs(${slug}) failed: ${error?.message ?? "no id returned"}`);
  }
  createdOrgIds.push(data);
  if ((options.plan ?? "starter") === "starter") {
    const admin = getAdminClient();
    const { error: subscriptionError } = await admin.from("subscriptions").insert({
      organization_id: data,
      provider_subscription_id: `fixture-subscription-${data}`,
      plan_code: "starter",
      status: "active",
      test_mode: true,
    });
    if (subscriptionError !== null) {
      throw new Error(`createOrgAs(${slug}) fixture billing setup failed: ${subscriptionError.message}`);
    }
  }
  return data;
}

/** Adds a member directly (service role). Only for fixture setup. */
export async function addMember(
  organizationId: string,
  userId: string,
  role: Database["public"]["Enums"]["app_role"],
): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin
    .from("organization_members")
    .insert({ organization_id: organizationId, user_id: userId, role });
  if (error !== null) {
    throw new Error(`addMember(${userId} → ${role}) failed: ${error.message}`);
  }
}

/** Service-role insert of an invite with full control over every field. */
export async function insertInvite(
  row: Database["public"]["Tables"]["organization_invites"]["Insert"],
): Promise<Database["public"]["Tables"]["organization_invites"]["Row"]> {
  const admin = getAdminClient();
  const { data, error } = await admin.from("organization_invites").insert(row).select().single();
  if (error !== null || data === null) {
    throw new Error(`insertInvite failed: ${error?.message ?? "no row returned"}`);
  }
  return data;
}

export async function disposeAll(): Promise<void> {
  const admin = getAdminClient();
  // Orgs first: cascades members, invites, audit events, trust center.
  for (const organizationId of createdOrgIds.splice(0)) {
    await admin.from("organizations").delete().eq("id", organizationId);
  }
  for (const userId of createdUserIds.splice(0)) {
    await admin.auth.admin.deleteUser(userId);
  }
}
