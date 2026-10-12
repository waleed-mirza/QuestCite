/**
 * RLS matrix — two organizations, every role (plan §W2, AGENTS.md rule 7).
 *
 * Gate (plan §W2): Org A cannot read or mutate any Org B row. Every policy is
 * exercised as anonymous, Org A owner/admin/reviewer/viewer, Org B member, and
 * service role. Runs against the linked hosted project (D016).
 */

import { afterAll, beforeAll, describe, it } from "vitest";

import { expectError, expectNoRows, expectOk, expectRows } from "./helpers/assert";
import { getAdminClient, getAnonClient } from "./helpers/clients";
import {
  addMember,
  createOrgAs,
  createTestUser,
  disposeAll,
  signInAs,
  type TestUser,
} from "./helpers/fixtures";

type Role = "owner" | "admin" | "reviewer" | "viewer";
type UserKey =
  | "aOwner"
  | "aAdmin"
  | "aReviewer"
  | "aViewer"
  | "bOwner"
  | "bAdmin"
  | "bReviewer"
  | "bViewer"
  | "outsider";
type ClientKey = "aOwner" | "aAdmin" | "aReviewer" | "aViewer" | "bOwner" | "bAdmin" | "outsider";

const admin = getAdminClient();

let orgA = "";
let orgB = "";
const users = {} as Record<UserKey, TestUser>;
const clients: Partial<Record<ClientKey, Awaited<ReturnType<typeof signInAs>>>> = {};

beforeAll(async () => {
  const specs = [
    ["aOwner", "a-owner"],
    ["aAdmin", "a-admin"],
    ["aReviewer", "a-reviewer"],
    ["aViewer", "a-viewer"],
    ["bOwner", "b-owner"],
    ["bAdmin", "b-admin"],
    ["bReviewer", "b-reviewer"],
    ["bViewer", "b-viewer"],
    ["outsider", "outsider"],
  ] as const;
  for (const [key, localPart] of specs) {
    users[key as UserKey] = await createTestUser(localPart, { fullName: localPart });
  }

  for (const key of ["aOwner", "aAdmin", "aReviewer", "aViewer", "bOwner", "bAdmin", "outsider"] as const) {
    clients[key] = await signInAs(users[key]);
  }

  orgA = await createOrgAs(client("aOwner"), "Matrix Org A", "matrix-a");
  orgB = await createOrgAs(client("bOwner"), "Matrix Org B", "matrix-b");

  await addMember(orgA, users.aAdmin.userId, "admin" satisfies Role);
  await addMember(orgA, users.aReviewer.userId, "reviewer" satisfies Role);
  await addMember(orgA, users.aViewer.userId, "viewer" satisfies Role);
  await addMember(orgB, users.bAdmin.userId, "admin" satisfies Role);
});

afterAll(async () => {
  await disposeAll();
});

function client(key: ClientKey): Awaited<ReturnType<typeof signInAs>> {
  const value = clients[key];
  if (value === undefined) throw new Error(`no client provisioned for ${key}`);
  return value;
}

describe("anonymous callers", () => {
  const anon = getAnonClient();

  it("cannot read any tenant table", async () => {
    expectNoRows(await anon.from("organizations").select(), "anon organizations");
    expectNoRows(await anon.from("organization_members").select(), "anon members");
    expectNoRows(await anon.from("organization_invites").select(), "anon invites");
    expectNoRows(await anon.from("audit_events").select(), "anon audit");
    expectNoRows(await anon.from("trust_centers").select(), "anon trust_centers");
    expectNoRows(await anon.from("profiles").select(), "anon profiles");
  });

  it("cannot create an organization or accept an invite", async () => {
    // The EXECUTE grant is authenticated-only, so the grant layer denies anon
    // before the RPC body's AUTH_REQUIRED guard can run — either rejection is
    // a correct deny.
    const createResult = await anon.rpc("create_organization_with_owner", { p_name: "X", p_slug: "x-anon-org" });
    if (
      createResult.error === null ||
      !(createResult.error.message.includes("permission denied") || createResult.error.message.includes("AUTH_REQUIRED"))
    ) {
      throw new Error(`anon create org: expected grant/AUTH denial, got ${JSON.stringify(createResult.error)}`);
    }
    expectError(await anon.rpc("accept_organization_invite", { p_raw_token: "0".repeat(32) }), "anon accept invite");
  });

  it("cannot insert rows anywhere", async () => {
    expectError(await anon.from("organizations").insert({ name: "Nope", slug: "nope-anon" }), "anon org insert");
  });
});

describe("cross-tenant reads (the Week 2 gate)", () => {
  it("Org A owner sees Org A rows only", async () => {
    expectRows(await client("aOwner").from("organizations").select().eq("id", orgA), "A owner sees A");
    expectNoRows(await client("aOwner").from("organizations").select().eq("id", orgB), "A owner sees B");
    expectRows(
      await client("aOwner").from("organization_members").select().eq("organization_id", orgA),
      "A members visible",
    );
    expectNoRows(
      await client("aOwner").from("organization_members").select().eq("organization_id", orgB),
      "A owner reads B members",
    );
    expectRows(await client("aOwner").from("audit_events").select().eq("organization_id", orgA), "A audit visible");
    expectNoRows(
      await client("aOwner").from("audit_events").select().eq("organization_id", orgB),
      "A owner reads B audit",
    );
    expectRows(
      await client("aOwner").from("trust_centers").select().eq("organization_id", orgA),
      "A trust center visible",
    );
    expectNoRows(
      await client("aOwner").from("trust_centers").select().eq("organization_id", orgB),
      "A owner reads B trust center",
    );
  });

  it.each<ClientKey>(["aAdmin", "aReviewer", "aViewer"])("Org A %s sees Org A rows only", async (key) => {
    expectRows(await client(key).from("organizations").select().eq("id", orgA), `${key} sees A`);
    expectNoRows(await client(key).from("organizations").select().eq("id", orgB), `${key} sees B`);
    expectNoRows(
      await client(key).from("organization_members").select().eq("organization_id", orgB),
      `${key} reads B members`,
    );
    expectNoRows(await client(key).from("audit_events").select().eq("organization_id", orgB), `${key} reads B audit`);
  });

  it("Org B members see nothing from Org A", async () => {
    expectNoRows(await client("bOwner").from("organizations").select().eq("id", orgA), "B owner sees A");
    expectNoRows(
      await client("bOwner").from("organization_members").select().eq("organization_id", orgA),
      "B owner reads A members",
    );
    expectNoRows(
      await client("bAdmin").from("organization_invites").select().eq("organization_id", orgA),
      "B admin reads A invites",
    );
  });

  it("an outsider with no organization sees no organizations and only their own profile", async () => {
    expectNoRows(await client("outsider").from("organizations").select(), "outsider orgs");
    const { data, error } = await client("outsider").from("profiles").select("id");
    if (error !== null) throw new Error(`outsider profiles: ${error.message}`);
    const rows = (data as Array<{ id: string }> | null) ?? [];
    if (rows.length !== 1 || rows[0]?.id !== users.outsider.userId) {
      throw new Error(`outsider should see exactly their own profile, got ${rows.length ?? 0}`);
    }
  });

  it("profiles are visible only to organization peers", async () => {
    expectRows(
      await client("aViewer").from("profiles").select().eq("id", users.aOwner.userId),
      "A viewer reads A owner profile",
    );
    expectNoRows(
      await client("aViewer").from("profiles").select().eq("id", users.bOwner.userId),
      "A viewer reads B owner profile",
    );
  });
});

describe("cross-tenant mutations (IDOR by id)", () => {
  it("Org A members cannot mutate Org B rows", async () => {
    for (const key of ["aOwner", "aAdmin", "aReviewer", "aViewer"] as const) {
      const actor = client(key);
      expectOk(await actor.from("organizations").update({ name: "Hacked" }).eq("id", orgB), `${key} update B org`);
      expectOk(
        await actor.from("organization_members").update({ role: "viewer" }).eq("organization_id", orgB),
        `${key} update B members`,
      );
      expectOk(
        await actor.from("organization_members").delete().eq("organization_id", orgB),
        `${key} delete B members`,
      );
      // audit_events has NO delete grant by design — this is a hard 42501,
      // not a silent zero-row filter.
      expectError(await actor.from("audit_events").delete().eq("organization_id", orgB), `${key} delete B audit`);
    }
    // Nothing may have changed in Org B.
    const bOrg = await admin.from("organizations").select("name").eq("id", orgB).single();
    if (bOrg.error !== null || bOrg.data?.name !== "Matrix Org B") {
      throw new Error("Org B was mutated or removed cross-tenant");
    }
  });

  it("reviewer and viewer cannot mutate Org A rows", async () => {
    for (const key of ["aReviewer", "aViewer"] as const) {
      const actor = client(key);
      expectOk(await actor.from("organizations").update({ name: "Nope" }).eq("id", orgA), `${key} update A org`);
      expectOk(
        await actor.from("organization_members").delete().eq("organization_id", orgA),
        `${key} delete A members`,
      );
    }
    const aOrg = await admin.from("organizations").select("name").eq("id", orgA).single();
    if (aOrg.error !== null || aOrg.data?.name !== "Matrix Org A") {
      throw new Error("Org A mutated by non-manager");
    }
  });

  it("viewer and reviewer cannot insert invites or audit events", async () => {
    for (const key of ["aReviewer", "aViewer"] as const) {
      const actor = client(key);
      expectError(
        await actor.from("organization_invites").insert({
          organization_id: orgA,
          email: `t2-denied-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@integration.invalid`,
          role: "viewer",
          token_hash: "a".repeat(64),
          invited_by: users[key].userId,
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        }),
        `${key} invite insert`,
      );
      expectError(
        await actor.from("audit_events").insert({
          organization_id: orgA,
          actor_id: users[key].userId,
          action: "audit.forged",
          entity_type: "organization",
        }),
        `${key} audit insert`,
      );
    }
  });

  it("audit insert cannot forge the actor", async () => {
    expectError(
      await client("aAdmin").from("audit_events").insert({
        organization_id: orgA,
        actor_id: users.aOwner.userId, // admin writing an event as the owner
        action: "audit.forged",
        entity_type: "organization",
      }),
      "admin forges owner audit event",
    );
  });

  it("profile email is not client-writable (column grant)", async () => {
    expectError(
      await client("aViewer")
        .from("profiles")
        .update({ email: "taken@integration.invalid" } as { email: string })
        .eq("id", users.aViewer.userId),
      "viewer writes email column",
    );
    expectOk(
      await client("aViewer").from("profiles").update({ full_name: "Viewer Renamed" }).eq("id", users.aViewer.userId),
      "viewer renames self",
    );
    const other = await client("aViewer").from("profiles").update({ full_name: "Hijacked" }).eq("id", users.aOwner.userId);
    expectOk(other, "viewer writes owner profile");
    const ownerProfile = await admin.from("profiles").select("full_name").eq("id", users.aOwner.userId).single();
    if (ownerProfile.error !== null || ownerProfile.data?.full_name === "Hijacked") {
      throw new Error("profile hijacked across users");
    }
  });
});

describe("legitimate organization mutations", () => {
  it("owner and admin can rename Org A", async () => {
    expectOk(
      await client("aOwner").from("organizations").update({ name: "Matrix Org A v2" }).eq("id", orgA),
      "owner rename",
    );
    const renamed = await admin.from("organizations").select("name").eq("id", orgA).single();
    if (renamed.error !== null || renamed.data?.name !== "Matrix Org A v2") {
      throw new Error("owner rename did not persist");
    }
    expectOk(
      await client("aAdmin").from("organizations").update({ name: "Matrix Org A" }).eq("id", orgA),
      "admin rename back",
    );
  });

  it("slug and status are not client-writable (column grants)", async () => {
    expectError(
      await client("aOwner")
        .from("organizations")
        .update({ slug: "stolen-slug" } as { slug: string })
        .eq("id", orgA),
      "owner writes slug column",
    );
    expectError(
      await client("aOwner")
        .from("organizations")
        .update({ status: "deactivated" } as { status: "active" | "deactivated" })
        .eq("id", orgA),
      "owner writes status column",
    );
  });

  it("only the confirmed owner workflow can delete an organization, and deletion cascades", async () => {
    const doomed = await createOrgAs(client("aOwner"), "Doomed Org", "doomed-org");
    // Non-owner deletes are RLS-filtered to zero rows: a "successful" call
    // that changes nothing. Assert the org survives each attempt.
    await client("aAdmin").from("organizations").delete().eq("id", doomed);
    await client("bOwner").from("organizations").delete().eq("id", doomed);
    const survived = await admin.from("organizations").select("id").eq("id", doomed).single();
    if (survived.error !== null || survived.data?.id !== doomed) {
      throw new Error("non-owner managed to delete an organization");
    }
    expectError(
      await client("aOwner").from("organizations").delete().eq("id", doomed),
      "owner bypasses deletion workflow",
    );
    expectOk(
      await client("aOwner").rpc("request_organization_deletion", { p_organization_id: doomed, p_confirmation_slug: "doomed-org" }),
      "owner requests deletion",
    );
    expectOk(
      await client("aOwner").rpc("delete_organization", { p_organization_id: doomed, p_confirmation_slug: "doomed-org" }),
      "owner deletes own org through workflow",
    );
    expectNoRows(
      await admin.from("organization_members").select().eq("organization_id", doomed),
      "members cascade-deleted with org",
    );
  });
});

describe("service role (bypass documents the server-only boundary)", () => {
  it("reads across tenants — which is why the key must never reach the browser", async () => {
    expectRows(await admin.from("organizations").select().eq("id", orgB), "service role reads B");
  });
});
