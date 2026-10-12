/**
 * Member management — role changes per the permission matrix (PRD §5) and
 * final-owner protection (plan §7). Runs against the linked hosted project.
 */

import { afterAll, beforeAll, describe, it } from "vitest";

import { expectErrorWithCode, expectOk } from "./helpers/assert";
import { getAdminClient } from "./helpers/clients";
import {
  addMember,
  createOrgAs,
  createTestUser,
  disposeAll,
  signInAs,
  type TestUser,
} from "./helpers/fixtures";

const admin = getAdminClient();

let orgId = "";
let ownerClient!: Awaited<ReturnType<typeof signInAs>>;
let adminClient!: Awaited<ReturnType<typeof signInAs>>;
let viewerClient!: Awaited<ReturnType<typeof signInAs>>;
let owner!: TestUser;
let aViewer!: TestUser;

beforeAll(async () => {
  owner = await createTestUser("mm-owner", { fullName: "MM Owner" });
  const aAdmin = await createTestUser("mm-admin");
  aViewer = await createTestUser("mm-viewer");

  ownerClient = await signInAs(owner);
  adminClient = await signInAs(aAdmin);
  viewerClient = await signInAs(aViewer);

  orgId = await createOrgAs(ownerClient, "Member Org", "member-org");
  await addMember(orgId, aAdmin.userId, "admin");
  await addMember(orgId, aViewer.userId, "viewer");
});

afterAll(async () => {
  await disposeAll();
});

describe("role changes", () => {
  it("owner promotes viewer → admin", async () => {
    expectOk(
      await ownerClient
        .from("organization_members")
        .update({ role: "admin" })
        .eq("organization_id", orgId)
        .eq("user_id", aViewer.userId),
      "owner promotes",
    );
    // restore for later tests
    expectOk(
      await ownerClient
        .from("organization_members")
        .update({ role: "viewer" })
        .eq("organization_id", orgId)
        .eq("user_id", aViewer.userId),
      "owner restores",
    );
  });

  it("admin changes a viewer's role", async () => {
    expectOk(
      await adminClient
        .from("organization_members")
        .update({ role: "reviewer" })
        .eq("organization_id", orgId)
        .eq("user_id", aViewer.userId),
      "admin changes viewer",
    );
    expectOk(
      await ownerClient
        .from("organization_members")
        .update({ role: "viewer" })
        .eq("organization_id", orgId)
        .eq("user_id", aViewer.userId),
      "owner restores",
    );
  });

  it("admin cannot elevate a member to owner (WITH CHECK)", async () => {
    const result = await adminClient
      .from("organization_members")
      .update({ role: "owner" })
      .eq("organization_id", orgId)
      .eq("user_id", aViewer.userId);
    if (result.error === null) throw new Error("admin created a second owner");
  });

  it("admin cannot change their own role", async () => {
    const adminUser = await adminClient.auth.getUser();
    const adminId = adminUser.data.user?.id ?? "";
    // USING filters the admin's own row out — a silent zero-row update.
    const result = await adminClient
      .from("organization_members")
      .update({ role: "viewer" })
      .eq("organization_id", orgId)
      .eq("user_id", adminId);
    if (result.error !== null) throw new Error(`unexpected error: ${result.error.message}`);
    const role = await admin.from("organization_members").select("role").eq("organization_id", orgId).eq("user_id", adminId).single();
    if (role.error !== null || role.data?.role !== "admin") {
      throw new Error("admin changed their own role");
    }
  });

  it("admin cannot change an owner's role", async () => {
    const result = await adminClient
      .from("organization_members")
      .update({ role: "viewer" })
      .eq("organization_id", orgId)
      .eq("user_id", owner.userId);
    if (result.error !== null) throw new Error(`unexpected error: ${result.error.message}`);
    const role = await admin.from("organization_members").select("role").eq("organization_id", orgId).eq("user_id", owner.userId).single();
    if (role.error !== null || role.data?.role !== "owner") {
      throw new Error("admin demoted an owner");
    }
  });

  it("viewer cannot change any role", async () => {
    const result = await viewerClient
      .from("organization_members")
      .update({ role: "admin" })
      .eq("organization_id", orgId)
      .eq("user_id", aViewer.userId);
    if (result.error !== null) throw new Error(`unexpected error: ${result.error.message}`);
    const role = await admin.from("organization_members").select("role").eq("organization_id", orgId).eq("user_id", aViewer.userId).single();
    if (role.error !== null || role.data?.role !== "viewer") {
      throw new Error("viewer self-promoted");
    }
  });
});

describe("final-owner protection (plan §7)", () => {
  it("the last owner cannot demote themselves", async () => {
    expectErrorWithCode(
      await ownerClient
        .from("organization_members")
        .update({ role: "admin" })
        .eq("organization_id", orgId)
        .eq("user_id", owner.userId),
      "FINAL_OWNER_PROTECTED",
      "demote last owner",
    );
  });

  it("the last owner cannot remove themselves", async () => {
    expectErrorWithCode(
      await ownerClient
        .from("organization_members")
        .delete()
        .eq("organization_id", orgId)
        .eq("user_id", owner.userId),
      "FINAL_OWNER_PROTECTED",
      "remove last owner",
    );
  });

  it("demotion works once a second owner exists; restoration needs another owner", async () => {
    const secondOwner = await createTestUser("mm-second-owner");
    await addMember(orgId, secondOwner.userId, "owner");
    const secondOwnerClient = await signInAs(secondOwner);
    expectOk(
      await ownerClient
        .from("organization_members")
        .update({ role: "admin" })
        .eq("organization_id", orgId)
        .eq("user_id", owner.userId),
      "first owner demotes self with second owner present",
    );
    // Only an owner can set an owner (the demoted first owner is now an
    // admin and filtered out of their own row) — the second owner restores.
    expectOk(
      await secondOwnerClient
        .from("organization_members")
        .update({ role: "owner" })
        .eq("organization_id", orgId)
        .eq("user_id", owner.userId),
      "second owner restores first owner",
    );
  });
});

describe("member removal", () => {
  it("admin removes a non-owner member; owner is untouchable by admins", async () => {
    const disposable = await createTestUser("mm-disposable");
    await addMember(orgId, disposable.userId, "viewer");
    expectOk(
      await adminClient
        .from("organization_members")
        .delete()
        .eq("organization_id", orgId)
        .eq("user_id", disposable.userId),
      "admin removes viewer",
    );
    const result = await adminClient
      .from("organization_members")
      .delete()
      .eq("organization_id", orgId)
      .eq("user_id", owner.userId);
    if (result.error !== null) throw new Error(`unexpected error: ${result.error.message}`);
    const ownerRow = await admin
      .from("organization_members")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", owner.userId)
      .single();
    if (ownerRow.error !== null || ownerRow.data?.role !== "owner") {
      throw new Error("admin removed an owner");
    }
  });
});
