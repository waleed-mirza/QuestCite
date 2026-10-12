/**
 * Storage isolation for the private `documents` bucket (plan §7/§9 + W3 gate):
 * path-derived org policies, signed-URL behavior, and the rule that files are
 * never public via raw URLs. Runs against the linked hosted project.
 */

import { afterAll, beforeAll, describe, it } from "vitest";

import { expectError, expectNoRows, expectOk } from "./helpers/assert";
import { getAnonClient, supabaseUrl } from "./helpers/clients";
import { cleanupStorage, trackStoragePath } from "./helpers/documents";
import {
  createOrgAs,
  createTestUser,
  disposeAll,
  signInAs,
  type TestUser,
} from "./helpers/fixtures";

let orgA = "";
let ownerA!: TestUser;
let ownerAClient!: Awaited<ReturnType<typeof signInAs>>;
let ownerBClient!: Awaited<ReturnType<typeof signInAs>>;

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);

async function uploadForOrg(
  client: Awaited<ReturnType<typeof signInAs>>,
  path: string,
): Promise<void> {
  const result = await client.storage.from("documents").upload(path, PDF_BYTES, {
    contentType: "application/pdf",
  });
  if (result.error === null) {
    trackStoragePath(path);
  }
  expectOk({ data: result.data, error: result.error }, `upload ${path}`);
}

beforeAll(async () => {
  ownerA = await createTestUser("st-owner-a");
  const ownerB = await createTestUser("st-owner-b");
  ownerAClient = await signInAs(ownerA);
  ownerBClient = await signInAs(ownerB);
  orgA = await createOrgAs(ownerAClient, "Storage Org A", `st-org-a-${Date.now().toString(36)}`);
});

afterAll(async () => {
  await cleanupStorage();
  await disposeAll();
});

describe("bucket privacy", () => {
  it("raw object URLs are never accessible without a signed token", async () => {
    const path = `${orgA}/${crypto.randomUUID()}/${crypto.randomUUID()}/direct.pdf`;
    await uploadForOrg(ownerAClient, path);

    const rawResponse = await fetch(`${supabaseUrl()}/storage/v1/object/documents/${path}`);
    if (rawResponse.ok) {
      throw new Error("raw object URL is publicly readable — bucket privacy broken");
    }
  });
});

describe("path-derived org policies", () => {
  it("a member uploads into their own org prefix", async () => {
    const path = `${orgA}/${crypto.randomUUID()}/${crypto.randomUUID()}/policy.pdf`;
    await uploadForOrg(ownerAClient, path);
  });

  it("uploads into ANOTHER org's prefix are denied", async () => {
    const foreignPath = `${orgA}/${crypto.randomUUID()}/${crypto.randomUUID()}/intrusion.pdf`;
    expectError(
      await ownerBClient.storage.from("documents").upload(foreignPath, PDF_BYTES, { contentType: "application/pdf" }),
      "cross-org upload",
    );
  });

  it("malformed keys are denied even inside the member's own prefix", async () => {
    // Three segments instead of four — not a document object shape.
    const malformed = `${orgA}/not-a-document-key.pdf`;
    expectError(
      await ownerAClient.storage.from("documents").upload(malformed, PDF_BYTES, { contentType: "application/pdf" }),
      "malformed key upload",
    );
  });

  it("object listing is scoped to the caller's own org prefix only", async () => {
    const ownPath = `${orgA}/${crypto.randomUUID()}/${crypto.randomUUID()}/listed.pdf`;
    await uploadForOrg(ownerAClient, ownPath);

    const ownList = await ownerAClient.storage.from("documents").list(orgA, { limit: 100 });
    expectOk({ data: ownList.data, error: ownList.error }, "list own prefix");
    const names = (ownList.data ?? []).map((entry) => entry.name);
    if (names.length === 0) {
      throw new Error("expected own-org objects to be listable");
    }

    // Org B listing Org A's folder prefix must not reveal its contents.
    const foreignList = await ownerBClient.storage.from("documents").list(orgA, { limit: 100 });
    expectNoRows({ data: foreignList.data, error: foreignList.error }, "B lists A prefix");
  });
});

describe("signed URLs", () => {
  it("members sign their own objects; the token works anonymously until expiry", async () => {
    const path = `${orgA}/${crypto.randomUUID()}/${crypto.randomUUID()}/signed.pdf`;
    await uploadForOrg(ownerAClient, path);

    const signed = await ownerAClient.storage.from("documents").createSignedUrl(path, 60);
    expectOk({ data: signed.data, error: signed.error }, "sign own object");
    // supabase-js returns the signed URL as an absolute URL.
    const signedUrl = signed.data?.signedUrl ?? "";
    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new Error(`signed URL download failed: ${response.status}`);
    }
    const body = await response.arrayBuffer();
    if (body.byteLength !== PDF_BYTES.byteLength) {
      throw new Error("signed download returned wrong bytes");
    }
  });

  it("cross-org signing is denied (no existence leak)", async () => {
    const path = `${orgA}/${crypto.randomUUID()}/${crypto.randomUUID()}/secret.pdf`;
    await uploadForOrg(ownerAClient, path);

    const foreign = await ownerBClient.storage.from("documents").createSignedUrl(path, 60);
    if (foreign.error === null && foreign.data?.signedUrl) {
      throw new Error("Org B obtained a signed URL for Org A's object");
    }
  });

  it("signed URLs expire (1-second TTL is dead after 3 seconds)", async () => {
    const path = `${orgA}/${crypto.randomUUID()}/${crypto.randomUUID()}/expiring.pdf`;
    await uploadForOrg(ownerAClient, path);

    const signed = await ownerAClient.storage.from("documents").createSignedUrl(path, 1);
    expectOk({ data: signed.data, error: signed.error }, "sign short-lived");
    const signedUrl = signed.data?.signedUrl ?? "";

    await new Promise((resolve) => setTimeout(resolve, 3000));
    const expired = await fetch(signedUrl);
    if (expired.ok) {
      throw new Error("expired signed URL still downloads");
    }
  });

  it("anonymous sessions cannot read objects even listable metadata", async () => {
    const anon = getAnonClient();
    expectNoRows(
      await anon.storage.from("documents").list(orgA, { limit: 10 }),
      "anon lists A prefix",
    );
  });
});
