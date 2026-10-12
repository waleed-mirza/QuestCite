/**
 * Database constraint, trigger, and transaction tests (plan §W2 "Database
 * constraint and transaction tests"). Exercises create_organization_with_owner
 * error paths, the profile-creation trigger, atomicity, and schema backstops.
 */

import { afterAll, beforeAll, describe, it } from "vitest";

import { expectError, expectErrorWithCode, expectRows } from "./helpers/assert";
import { getAdminClient, getAnonClient } from "./helpers/clients";
import {
  addMember,
  createOrgAs,
  createTestUser,
  disposeAll,
  PASSWORD,
  signInAs,
  type TestUser,
} from "./helpers/fixtures";

const DAY_MS = 86_400_000;
const admin = getAdminClient();
const anon = getAnonClient();

let ownerClient!: Awaited<ReturnType<typeof signInAs>>;
let owner!: TestUser;
let existingOrgSlug: string;

beforeAll(async () => {
  owner = await createTestUser("con-owner", { fullName: "Constraint Owner" });
  ownerClient = await signInAs(owner);
  existingOrgSlug = `con-org-${Date.now().toString(36)}`;
  await createOrgAs(ownerClient, "Constraint Org", existingOrgSlug);
});

afterAll(async () => {
  await disposeAll();
});

describe("create_organization_with_owner error paths", () => {
  it("rejects reserved slugs and creates nothing", async () => {
    const before = await ownerClient.from("organizations").select("id");
    if (before.error !== null) throw new Error(before.error.message);
    expectErrorWithCode(
      await ownerClient.rpc("create_organization_with_owner", { p_name: "Demo Corp", p_slug: "demo" }),
      "SLUG_RESERVED",
      "reserved slug",
    );
    const after = await ownerClient.from("organizations").select("id");
    if (after.error !== null) throw new Error(after.error.message);
    if ((before.data ?? []).length !== (after.data ?? []).length) {
      throw new Error("rejected creation still mutated state");
    }
  });

  it("rejects slug collisions case-insensitively", async () => {
    expectErrorWithCode(
      await ownerClient.rpc("create_organization_with_owner", { p_name: "Clone", p_slug: existingOrgSlug }),
      "SLUG_TAKEN",
      "exact slug collision",
    );
    expectErrorWithCode(
      await ownerClient.rpc("create_organization_with_owner", { p_name: "Clone", p_slug: existingOrgSlug.toUpperCase() }),
      "SLUG_TAKEN",
      "case-variant slug collision",
    );
  });

  it("normalizes slug casing before insert", async () => {
    const suffix = Date.now().toString(36);
    const mixed = `Mixed-Case-${suffix}`;
    const id = await createOrgAs(ownerClient, "Mixed Case Org", mixed);
    const row = await admin.from("organizations").select("slug").eq("id", id).single();
    if (row.error !== null || row.data?.slug !== mixed.toLowerCase()) {
      throw new Error(`slug not normalized: ${row.data?.slug ?? row.error?.message}`);
    }
  });

  it("rejects malformed slugs (schema CHECK backstop)", async () => {
    expectError(
      await ownerClient.rpc("create_organization_with_owner", { p_name: "Short", p_slug: "ab" }),
      "slug too short",
    );
    expectError(
      await ownerClient.rpc("create_organization_with_owner", { p_name: "Spaces", p_slug: "has space" }),
      "slug with space",
    );
    expectError(
      await ownerClient.rpc("create_organization_with_owner", { p_name: "Edge", p_slug: "-leading" }),
      "leading hyphen",
    );
  });

  it("rejects empty names", async () => {
    expectError(
      await ownerClient.rpc("create_organization_with_owner", { p_name: "   ", p_slug: "blank-name-org" }),
      "blank name",
    );
  });

  it("blocks unverified users at the auth layer (RPC check stays a backstop)", async () => {
    // GoTrue refuses password sign-in for unconfirmed users entirely, so an
    // unconfirmed session cannot reach the RPC through the public API — the
    // create_organization_with_owner EMAIL_NOT_VERIFIED check is defense in
    // depth for exotic session paths (e.g. confirmation later disabled).
    const unverified = await createTestUser("con-unverified", { confirmEmail: false });
    const { error } = await anon.auth.signInWithPassword({ email: unverified.email, password: PASSWORD });
    if (error === null) {
      throw new Error("unconfirmed user was able to sign in with a password");
    }
  });

  it("atomicity: an org with a trust center and audit row is created in one shot", async () => {
    const suffix = Date.now().toString(36);
    const orgId = await createOrgAs(ownerClient, "Atomic Org", `atomic-${suffix}`);
    expectRows(
      await ownerClient.from("trust_centers").select().eq("organization_id", orgId),
      "default trust center created",
    );
    const audit = await ownerClient
      .from("audit_events")
      .select("action")
      .eq("organization_id", orgId)
      .eq("action", "organization.created");
    expectRows(audit, "creation audit event written");
    // W7 (0021) replaced `published` with the status enum; the default
    // guarantee this W2 test pins is "not publicly visible" = draft.
    const status = await ownerClient.from("trust_centers").select("status").eq("organization_id", orgId).single();
    if (status.error !== null || status.data?.status !== "draft") {
      throw new Error("default trust center must start as draft (not public)");
    }
  });
});

describe("profile lifecycle trigger", () => {
  it("creates a profile for new users with metadata name", async () => {
    const user = await createTestUser("con-profile", { fullName: "Profile Person" });
    const row = await admin.from("profiles").select("full_name, email").eq("id", user.userId).single();
    if (row.error !== null) throw new Error(`profile trigger failed: ${row.error.message}`);
    if (row.data?.full_name !== "Profile Person") {
      throw new Error(`full_name not sourced from metadata: ${row.data?.full_name ?? "null"}`);
    }
  });

  it("keeps profiles.email in sync when the auth email changes", async () => {
    const user = await createTestUser("con-email-sync");
    const newEmail = `${user.email.replace("@", "+renamed@")}`;
    const updated = await admin.auth.admin.updateUserById(user.userId, { email: newEmail });
    if (updated.error !== null) throw new Error(`email update failed: ${updated.error.message}`);
    const row = await admin.from("profiles").select("email").eq("id", user.userId).single();
    if (row.error !== null || row.data?.email !== newEmail) {
      throw new Error(`profile email not synced: ${row.data?.email ?? row.error?.message}`);
    }
  });
});

describe("schema backstops (service role — bypasses RLS, never CHECKs)", () => {
  it("enforces unique (organization, user) membership", async () => {
    const orgId = await createOrgAs(ownerClient, "Dup Org", `dup-org-${Date.now().toString(36)}`);
    const second = await createTestUser("con-dup-member");
    await addMember(orgId, second.userId, "viewer");
    expectError(
      await admin.from("organization_members").insert({ organization_id: orgId, user_id: second.userId, role: "admin" }),
      "duplicate membership insert",
    );
  });

  it("rejects invites whose hash is not sha256-hex", async () => {
    const orgId = await createOrgAs(ownerClient, "Hash Org", `hash-org-${Date.now().toString(36)}`);
    expectError(
      await admin.from("organization_invites").insert({
        organization_id: orgId,
        email: "x@example.com",
        role: "viewer",
        token_hash: "not-a-hash",
        invited_by: owner.userId,
        expires_at: new Date(Date.now() + DAY_MS).toISOString(),
      }),
      "malformed token hash",
    );
  });

  it("rejects invite expiry before creation time", async () => {
    const orgId = await createOrgAs(ownerClient, "Expiry Org", `expiry-org-${Date.now().toString(36)}`);
    expectError(
      await admin.from("organization_invites").insert({
        organization_id: orgId,
        email: "x@example.com",
        role: "viewer",
        token_hash: "b".repeat(64),
        invited_by: owner.userId,
        created_at: new Date(Date.now() - DAY_MS).toISOString(),
        expires_at: new Date(Date.now() - 2 * DAY_MS).toISOString(),
      }),
      "expiry before creation",
    );
  });

  it("enforces invite emails look like emails", async () => {
    const orgId = await createOrgAs(ownerClient, "Mail Org", `mail-org-${Date.now().toString(36)}`);
    expectError(
      await admin.from("organization_invites").insert({
        organization_id: orgId,
        email: "not-an-email",
        role: "viewer",
        token_hash: "c".repeat(64),
        invited_by: owner.userId,
        expires_at: new Date(Date.now() + DAY_MS).toISOString(),
      }),
      "malformed invite email",
    );
  });
});

describe("RPC privilege surface", () => {
  it("anon cannot execute the org RPCs — the authenticated-only EXECUTE grant denies first", async () => {
    // The grant layer's "permission denied" fires before the function body's
    // AUTH_REQUIRED guard; either constitutes a correct deny.
    const createResult = await anon.rpc("create_organization_with_owner", { p_name: "A", p_slug: "abc" });
    if (
      createResult.error === null ||
      !(createResult.error.message.includes("permission denied") || createResult.error.message.includes("AUTH_REQUIRED"))
    ) {
      throw new Error(`anon RPC create: unexpected outcome ${JSON.stringify(createResult.error)}`);
    }
    expectError(
      await anon.rpc("revoke_organization_invite", {
        p_organization_id: "00000000-0000-0000-0000-000000000000",
        p_invite_id: "00000000-0000-0000-0000-000000000000",
      }),
      "anon RPC revoke",
    );
  });
});
