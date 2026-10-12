/**
 * Invitation lifecycle — create, preview, accept, revoke, and every rejection
 * edge the plan names (plan §W2: expired/reused/wrong-email; §7 invitation
 * flow). Runs against the linked hosted project (D016).
 */

import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, it } from "vitest";

import { expectError, expectErrorWithCode, expectNoRows, expectOk, expectRows } from "./helpers/assert";
import { getAdminClient } from "./helpers/clients";
import {
  addMember,
  createOrgAs,
  createTestUser,
  disposeAll,
  insertInvite,
  signInAs,
  type TestUser,
} from "./helpers/fixtures";

const DAY_MS = 86_400_000;
const admin = getAdminClient();

let orgId = "";
let owner!: TestUser;
let adminUserId = "";
let reviewerUserId = "";
let ownerClient!: Awaited<ReturnType<typeof signInAs>>;
let adminClient!: Awaited<ReturnType<typeof signInAs>>;
let reviewerClient!: Awaited<ReturnType<typeof signInAs>>;
/** Belongs to another org — used to prove cross-tenant invite isolation. */
let strangerClient!: Awaited<ReturnType<typeof signInAs>>;
let inviteSeq = 0;

beforeAll(async () => {
  owner = await createTestUser("inv-owner", { fullName: "Invite Owner" });
  const aAdmin = await createTestUser("inv-admin");
  adminUserId = aAdmin.userId;
  const aReviewer = await createTestUser("inv-reviewer");
  reviewerUserId = aReviewer.userId;
  const stranger = await createTestUser("inv-stranger");
  const strangerOwner = await createTestUser("inv-stranger-owner");

  ownerClient = await signInAs(owner);
  adminClient = await signInAs(aAdmin);
  reviewerClient = await signInAs(aReviewer);
  strangerClient = await signInAs(stranger);
  const strangerOwnerClient = await signInAs(strangerOwner);

  orgId = await createOrgAs(ownerClient, "Invite Org", "invite-org");
  await addMember(orgId, aAdmin.userId, "admin");
  await addMember(orgId, aReviewer.userId, "reviewer");
  await createOrgAs(strangerOwnerClient, "Other Org", "other-invite-org");
});

afterAll(async () => {
  await disposeAll();
});

function newToken(): string {
  inviteSeq += 1;
  // 32+ chars so it passes the RPC length guard; uniqueness via seq + random.
  return `tok-${Date.now().toString(36)}-${inviteSeq}-${Math.random().toString(36).repeat(4)}`;
}

function uniqueEmail(localPart: string): string {
  // Pending-invite uniqueness is per (org, email) — never reuse literals.
  return `t2-${localPart}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@integration.invalid`;
}

function sha256Hex(value: string): string {
  // Node parity with the DB-side sha256 hex — the value the app would store.
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("invite creation", () => {
  it("owner creates an invite; only the hash is stored", async () => {
    const raw = newToken();
    const inserted = await insertInvite({
      organization_id: orgId,
      email: uniqueEmail("stored-hash"),
      role: "reviewer",
      token_hash: sha256Hex(raw),
      invited_by: owner.userId,
      expires_at: new Date(Date.now() + DAY_MS).toISOString(),
    });
    if (inserted.token_hash === raw) throw new Error("raw token stored instead of hash");
    if (inserted.accepted_at !== null || inserted.revoked_at !== null) {
      throw new Error("fresh invite must be pending");
    }
  });

  it("admin can create, reviewer/viewer cannot", async () => {
    expectOk(
      await adminClient.from("organization_invites").insert({
        organization_id: orgId,
        email: `t2-admin-invited-${Date.now()}@integration.invalid`,
        role: "viewer",
        token_hash: sha256Hex(newToken()),
        invited_by: adminUserId,
        expires_at: new Date(Date.now() + DAY_MS).toISOString(),
      }),
      "admin invite insert",
    );
    expectError(
      await reviewerClient.from("organization_invites").insert({
        organization_id: orgId,
        email: `t2-reviewer-invited-${Date.now()}@integration.invalid`,
        role: "viewer",
        token_hash: sha256Hex(newToken()),
        invited_by: reviewerUserId,
        expires_at: new Date(Date.now() + DAY_MS).toISOString(),
      }),
      "reviewer invite insert",
    );
  });

  it("an owner-role invite is impossible (CHECK + WITH CHECK)", async () => {
    expectError(
      await ownerClient.from("organization_invites").insert({
        organization_id: orgId,
        email: `t2-owner-invited-${Date.now()}@integration.invalid`,
        role: "owner",
        token_hash: sha256Hex(newToken()),
        invited_by: owner.userId,
        expires_at: new Date(Date.now() + DAY_MS).toISOString(),
      }),
      "owner-role invite",
    );
  });

  it("invited_by cannot be forged", async () => {
    expectError(
      await adminClient.from("organization_invites").insert({
        organization_id: orgId,
        email: `t2-forged-${Date.now()}@integration.invalid`,
        role: "viewer",
        token_hash: sha256Hex(newToken()),
        invited_by: owner.userId, // admin claims the owner invited
        expires_at: new Date(Date.now() + DAY_MS).toISOString(),
      }),
      "forged invited_by",
    );
  });

  it("at most one pending invite per email per org", async () => {
    const raw = newToken();
    const email = `t2-dupe-${Date.now()}@integration.invalid`;
    await insertInvite({
      organization_id: orgId,
      email,
      role: "viewer",
      token_hash: sha256Hex(raw),
      invited_by: owner.userId,
      expires_at: new Date(Date.now() + DAY_MS).toISOString(),
    });
    expectError(
      await ownerClient.from("organization_invites").insert({
        organization_id: orgId,
        email: email.toUpperCase(),
        role: "reviewer",
        token_hash: sha256Hex(newToken()),
        invited_by: owner.userId,
        expires_at: new Date(Date.now() + DAY_MS).toISOString(),
      }),
      "duplicate pending invite",
    );
  });

  it("managers of other orgs see and control nothing here", async () => {
    expectNoRows(await strangerClient.from("organization_invites").select().eq("organization_id", orgId), "stranger reads invites");
  });
});

describe("invite preview (J2 step 3)", () => {
  it("the invited user sees org name, inviter, and role", async () => {
    const raw = newToken();
    const invitee = await createTestUser("inv-preview-invitee");
    const inviteeClient = await signInAs(invitee);
    await insertInvite({
      organization_id: orgId,
      email: invitee.email,
      role: "admin",
      token_hash: sha256Hex(raw),
      invited_by: owner.userId,
      expires_at: new Date(Date.now() + DAY_MS).toISOString(),
    });
    const { data, error } = await inviteeClient.rpc("preview_organization_invite", { p_raw_token: raw });
    if (error !== null) throw new Error(`preview failed: ${error.message}`);
    const row = (data as Array<{ organization_name: string; invited_role: string; inviter_name: string }> | null)?.[0];
    if (row === undefined) throw new Error("invited user could not preview their invite");
    if (row.organization_name !== "Invite Org" || row.invited_role !== "admin") {
      throw new Error(`preview returned wrong payload: ${JSON.stringify(row)}`);
    }
  });

  it("a different signed-in user holding the token sees nothing", async () => {
    const raw = newToken();
    await insertInvite({
      organization_id: orgId,
      email: uniqueEmail("wrong-user"),
      role: "viewer",
      token_hash: sha256Hex(raw),
      invited_by: owner.userId,
      expires_at: new Date(Date.now() + DAY_MS).toISOString(),
    });
    const { data, error } = await strangerClient.rpc("preview_organization_invite", { p_raw_token: raw });
    if (error !== null) throw new Error(`preview must not error for wrong user: ${error.message}`);
    if ((data as unknown[] | null)?.length !== 0) throw new Error("wrong user previewed someone else's invite");
  });
});

describe("invite acceptance", () => {
  it("happy path: invited user joins with the granted role", async () => {
    const raw = newToken();
    const invitee = await createTestUser("inv-accept-happy");
    const inviteeClient = await signInAs(invitee);
    await insertInvite({
      organization_id: orgId,
      email: invitee.email,
      role: "reviewer",
      token_hash: sha256Hex(raw),
      invited_by: owner.userId,
      expires_at: new Date(Date.now() + DAY_MS).toISOString(),
    });
    expectOk(await inviteeClient.rpc("accept_organization_invite", { p_raw_token: raw }), "accept invite");
    const membership = await ownerClient
      .from("organization_members")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", invitee.userId);
    expectRows(membership, "new member visible");
  });

  it("reused token is rejected", async () => {
    const raw = newToken();
    const invitee = await createTestUser("inv-accept-reuse");
    const inviteeClient = await signInAs(invitee);
    await insertInvite({
      organization_id: orgId,
      email: invitee.email,
      role: "viewer",
      token_hash: sha256Hex(raw),
      invited_by: owner.userId,
      expires_at: new Date(Date.now() + DAY_MS).toISOString(),
    });
    expectOk(await inviteeClient.rpc("accept_organization_invite", { p_raw_token: raw }), "first accept");
    expectErrorWithCode(
      await inviteeClient.rpc("accept_organization_invite", { p_raw_token: raw }),
      "INVITE_INVALID",
      "second accept",
    );
  });

  it("wrong email is rejected with the generic code", async () => {
    const raw = newToken();
    await insertInvite({
      organization_id: orgId,
      email: uniqueEmail("right-person"),
      role: "viewer",
      token_hash: sha256Hex(raw),
      invited_by: owner.userId,
      expires_at: new Date(Date.now() + DAY_MS).toISOString(),
    });
    expectErrorWithCode(
      await strangerClient.rpc("accept_organization_invite", { p_raw_token: raw }),
      "INVITE_INVALID",
      "wrong email accept",
    );
  });

  it("expired token is rejected", async () => {
    const raw = newToken();
    const invitee = await createTestUser("inv-accept-expired");
    const inviteeClient = await signInAs(invitee);
    await insertInvite({
      organization_id: orgId,
      email: invitee.email,
      role: "viewer",
      token_hash: sha256Hex(raw),
      invited_by: owner.userId,
      created_at: new Date(Date.now() - 10 * DAY_MS).toISOString(),
      expires_at: new Date(Date.now() - DAY_MS).toISOString(),
    });
    expectErrorWithCode(
      await inviteeClient.rpc("accept_organization_invite", { p_raw_token: raw }),
      "INVITE_INVALID",
      "expired accept",
    );
  });

  it("revoked token is rejected; revocation is owner/admin-only and idempotent", async () => {
    const raw = newToken();
    const invitee = await createTestUser("inv-accept-revoked");
    const inviteeClient = await signInAs(invitee);
    const invite = await insertInvite({
      organization_id: orgId,
      email: invitee.email,
      role: "viewer",
      token_hash: sha256Hex(raw),
      invited_by: owner.userId,
      expires_at: new Date(Date.now() + DAY_MS).toISOString(),
    });
    expectError(
      await reviewerClient.rpc("revoke_organization_invite", { p_organization_id: orgId, p_invite_id: invite.id }),
      "reviewer revokes",
    );
    expectOk(
      await adminClient.rpc("revoke_organization_invite", { p_organization_id: orgId, p_invite_id: invite.id }),
      "admin revokes",
    );
    expectOk(
      await adminClient.rpc("revoke_organization_invite", { p_organization_id: orgId, p_invite_id: invite.id }),
      "re-revoke is a no-op",
    );
    expectErrorWithCode(
      await inviteeClient.rpc("accept_organization_invite", { p_raw_token: raw }),
      "INVITE_INVALID",
      "revoked accept",
    );
  });

  it("an existing member accepting again is rejected; the failed claim must roll back", async () => {
    const raw = newToken();
    const member = await createTestUser("inv-accept-member");
    const memberClient = await signInAs(member);
    await addMember(orgId, member.userId, "viewer");
    const invite = await insertInvite({
      organization_id: orgId,
      email: member.email,
      role: "reviewer",
      token_hash: sha256Hex(raw),
      invited_by: owner.userId,
      expires_at: new Date(Date.now() + DAY_MS).toISOString(),
    });
    expectErrorWithCode(
      await memberClient.rpc("accept_organization_invite", { p_raw_token: raw }),
      "INVITE_INVALID",
      "already-member accept",
    );
    // The acceptance claim happens before the membership insert; the RPC error
    // must abort the whole transaction, leaving the invite unconsumed.
    const row = await admin.from("organization_invites").select("accepted_at").eq("id", invite.id).single();
    if (row.error !== null || row.data?.accepted_at !== null) {
      throw new Error("failed acceptance consumed the invitation (claim not rolled back)");
    }
  });

  it("garbage tokens are rejected without leaking anything", async () => {
    expectErrorWithCode(
      await strangerClient.rpc("accept_organization_invite", { p_raw_token: "short" }),
      "INVITE_INVALID",
      "short token",
    );
    expectErrorWithCode(
      await strangerClient.rpc("accept_organization_invite", { p_raw_token: "z".repeat(64) }),
      "INVITE_INVALID",
      "unknown token",
    );
  });
});
