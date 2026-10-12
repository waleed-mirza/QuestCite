/** Workspace settings and deletion RLS matrix (Week 8). */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { expectError, expectErrorWithCode, expectNoRows, expectOk } from "./helpers/assert";
import { getAdminClient, getAnonClient } from "./helpers/clients";
import {
  addMember,
  createOrgAs,
  createTestUser,
  disposeAll,
  signInAs,
  type TestUser,
} from "./helpers/fixtures";

type Client = Awaited<ReturnType<typeof signInAs>>;

let organizationId = "";
let owner!: TestUser;
let adminUser!: TestUser;
let reviewer!: TestUser;
let ownerClient!: Client;
let adminClient!: Client;
let reviewerClient!: Client;
let anon!: Client;

beforeAll(async () => {
  anon = getAnonClient();
  owner = await createTestUser("settings-owner");
  adminUser = await createTestUser("settings-admin");
  reviewer = await createTestUser("settings-reviewer");
  ownerClient = await signInAs(owner);
  adminClient = await signInAs(adminUser);
  reviewerClient = await signInAs(reviewer);
  organizationId = await createOrgAs(ownerClient, "Settings Org", `settings-${Date.now().toString(36)}`, { plan: "trial" });
  await addMember(organizationId, adminUser.userId, "admin");
  await addMember(organizationId, reviewer.userId, "reviewer");
});

afterAll(async () => {
  await disposeAll();
});

describe("settings RLS and input constraints", () => {
  it("starts with safe defaults and lets only a manager update them", async () => {
    const initial = await ownerClient
      .from("organizations")
      .select("retention_days,ai_drafts_disabled,deletion_requested_at")
      .eq("id", organizationId)
      .single();
    expectOk(initial, "read settings defaults");
    expect(initial.data).toMatchObject({ retention_days: 365, ai_drafts_disabled: false, deletion_requested_at: null });

    expectErrorWithCode(
      await reviewerClient.rpc("update_workspace_settings", {
        p_organization_id: organizationId,
        p_retention_days: 730,
        p_ai_drafts_disabled: true,
      }),
      "FORBIDDEN",
      "reviewer updates settings",
    );
    expectError(
      await anon.rpc("update_workspace_settings", {
        p_organization_id: organizationId,
        p_retention_days: 730,
        p_ai_drafts_disabled: true,
      }),
      "anon updates settings",
    );

    const updated = await adminClient.rpc("update_workspace_settings", {
      p_organization_id: organizationId,
      p_retention_days: 730,
      p_ai_drafts_disabled: true,
    });
    expectOk(updated, "admin updates settings");
    expect(updated.data?.[0]).toEqual({ retention_days: 730, ai_drafts_disabled: true });

    expectErrorWithCode(
      await ownerClient.rpc("update_workspace_settings", {
        p_organization_id: organizationId,
        p_retention_days: 29,
        p_ai_drafts_disabled: false,
      }),
      "SETTINGS_INPUT_INVALID",
      "retention lower bound",
    );
  });

  it("requires the exact slug and an explicit request before permanent deletion", async () => {
    const org = await ownerClient.from("organizations").select("slug").eq("id", organizationId).single();
    expectOk(org, "read deletion slug");
    if (org.data === null) throw new Error("deletion slug missing");
    const slug = org.data.slug;

    expectErrorWithCode(
      await adminClient.rpc("request_organization_deletion", {
        p_organization_id: organizationId,
        p_confirmation_slug: slug,
      }),
      "FORBIDDEN",
      "admin requests deletion",
    );
    expectErrorWithCode(
      await ownerClient.rpc("request_organization_deletion", {
        p_organization_id: organizationId,
        p_confirmation_slug: "wrong-slug",
      }),
      "DELETE_CONFIRMATION_INVALID",
      "wrong deletion confirmation",
    );

    const requested = await ownerClient.rpc("request_organization_deletion", {
      p_organization_id: organizationId,
      p_confirmation_slug: slug,
    });
    expectOk(requested, "request deletion");
    expect(requested.data).toBeTypeOf("string");

    const cancelled = await ownerClient.rpc("cancel_organization_deletion", { p_organization_id: organizationId });
    expectOk(cancelled, "cancel deletion");
    const afterCancel = await ownerClient.from("organizations").select("deletion_requested_at").eq("id", organizationId).single();
    expectOk(afterCancel, "read cancellation");
    if (afterCancel.data === null) throw new Error("settings row missing after cancellation");
    expect(afterCancel.data.deletion_requested_at).toBeNull();

    expectErrorWithCode(
      await ownerClient.rpc("delete_organization", {
        p_organization_id: organizationId,
        p_confirmation_slug: slug,
      }),
      "DELETION_NOT_REQUESTED",
      "delete without request",
    );
  });

  it("deletes only after a requested exact-match confirmation", async () => {
    const org = await ownerClient.from("organizations").select("slug").eq("id", organizationId).single();
    expectOk(org, "read final deletion slug");
    if (org.data === null) throw new Error("final deletion slug missing");
    const requested = await ownerClient.rpc("request_organization_deletion", {
      p_organization_id: organizationId,
      p_confirmation_slug: org.data.slug,
    });
    expectOk(requested, "request final deletion");
    const deleted = await ownerClient.rpc("delete_organization", {
      p_organization_id: organizationId,
      p_confirmation_slug: org.data.slug,
    });
    expectOk(deleted, "delete organization");
    expect(deleted.data).toBe(true);
    expectNoRows(
      await getAdminClient().from("organizations").select("id").eq("id", organizationId),
      "deleted organization is gone",
    );
  });
});
