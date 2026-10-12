/**
 * Storage isolation for the private `questionnaires` bucket (plan §7/§9 W4):
 * path-derived org policies with the REVIEWER-inclusive write role (import
 * is O/A/R per the permission matrix, unlike W3's owner/admin evidence
 * bucket). Bucket-privacy and signed-URL expiry mechanics are covered by the
 * documents suite — this file pins the role/path differences. Runs against
 * the linked hosted project (D016).
 */

import { afterAll, beforeAll, describe, it } from "vitest";

import { expectError, expectNoRows, expectOk } from "./helpers/assert";
import { cleanupQuestionnaireStorage, trackQuestionnaireStoragePath } from "./helpers/questionnaires";
import { supabaseUrl } from "./helpers/clients";
import {
  addMember,
  createOrgAs,
  createTestUser,
  disposeAll,
  signInAs,
  type TestUser,
} from "./helpers/fixtures";

type Client = Awaited<ReturnType<typeof signInAs>>;

let orgA = "";
let ownerA!: TestUser;
let reviewerA!: TestUser;
let viewerA!: TestUser;
let ownerB!: TestUser;
let ownerAClient!: Client;
let reviewerAClient!: Client;
let viewerAClient!: Client;
let ownerBClient!: Client;

const XLSX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function uploadForOrg(
  client: Client,
  path: string,
): Promise<void> {
  const result = await client.storage.from("questionnaires").upload(path, XLSX_BYTES, {
    contentType: XLSX_MIME,
  });
  if (result.error === null) {
    trackQuestionnaireStoragePath(path);
  }
  expectOk({ data: result.data, error: result.error }, `upload ${path}`);
}

beforeAll(async () => {
  ownerA = await createTestUser("qs-owner-a");
  reviewerA = await createTestUser("qs-reviewer-a");
  viewerA = await createTestUser("qs-viewer-a");
  ownerB = await createTestUser("qs-owner-b");
  ownerAClient = await signInAs(ownerA);
  reviewerAClient = await signInAs(reviewerA);
  viewerAClient = await signInAs(viewerA);
  ownerBClient = await signInAs(ownerB);
  orgA = await createOrgAs(ownerAClient, "QS Org A", `qs-org-a-${Date.now().toString(36)}`);
  await addMember(orgA, reviewerA.userId, "reviewer");
  await addMember(orgA, viewerA.userId, "viewer");
});

afterAll(async () => {
  await cleanupQuestionnaireStorage();
  await disposeAll();
});

describe("bucket privacy", () => {
  it("raw object URLs are never accessible without a signed token", async () => {
    const path = `${orgA}/${crypto.randomUUID()}/${crypto.randomUUID()}/direct.xlsx`;
    await uploadForOrg(ownerAClient, path);
    const rawResponse = await fetch(`${supabaseUrl()}/storage/v1/object/questionnaires/${path}`);
    if (rawResponse.ok) {
      throw new Error("raw object URL is publicly readable — bucket privacy broken");
    }
  });
});

describe("path-derived org policies", () => {
  it("a reviewer (not just owner/admin) uploads into their own org prefix", async () => {
    await uploadForOrg(reviewerAClient, `${orgA}/${crypto.randomUUID()}/${crypto.randomUUID()}/imported.xlsx`);
  });

  it("a viewer cannot upload at all", async () => {
    expectError(
      await viewerAClient.storage
        .from("questionnaires")
        .upload(`${orgA}/${crypto.randomUUID()}/${crypto.randomUUID()}/viewer.xlsx`, XLSX_BYTES, { contentType: XLSX_MIME }),
      "viewer upload",
    );
  });

  it("uploads into ANOTHER org's prefix are denied", async () => {
    expectError(
      await ownerBClient.storage
        .from("questionnaires")
        .upload(`${orgA}/${crypto.randomUUID()}/${crypto.randomUUID()}/intrusion.xlsx`, XLSX_BYTES, { contentType: XLSX_MIME }),
      "cross-org upload",
    );
  });

  it("malformed keys are denied even inside the member's own prefix", async () => {
    // Five segments — not a questionnaire object shape (0008 regression class).
    const fiveSegments = `${orgA}/${crypto.randomUUID()}/${crypto.randomUUID()}/extra/q.xlsx`;
    expectError(
      await ownerAClient.storage.from("questionnaires").upload(fiveSegments, XLSX_BYTES, { contentType: XLSX_MIME }),
      "five-segment key upload",
    );
    // Three segments — missing the file id segment.
    const threeSegments = `${orgA}/${crypto.randomUUID()}/q.xlsx`;
    expectError(
      await ownerAClient.storage.from("questionnaires").upload(threeSegments, XLSX_BYTES, { contentType: XLSX_MIME }),
      "three-segment key upload",
    );
  });

  it("object listing is scoped to the caller's own org prefix only", async () => {
    await uploadForOrg(ownerAClient, `${orgA}/${crypto.randomUUID()}/${crypto.randomUUID()}/listed.xlsx`);
    const ownList = await ownerAClient.storage.from("questionnaires").list(orgA, { limit: 100 });
    expectOk({ data: ownList.data, error: ownList.error }, "list own prefix");
    expectNoRows(
      await ownerBClient.storage.from("questionnaires").list(orgA, { limit: 100 }),
      "B lists A prefix",
    );
  });
});

describe("signed URLs", () => {
  it("members sign their own objects; the token downloads anonymously", async () => {
    const path = `${orgA}/${crypto.randomUUID()}/${crypto.randomUUID()}/signed.xlsx`;
    await uploadForOrg(ownerAClient, path);
    const signed = await ownerAClient.storage.from("questionnaires").createSignedUrl(path, 60);
    expectOk({ data: signed.data, error: signed.error }, "sign own object");
    const response = await fetch(signed.data?.signedUrl ?? "");
    if (!response.ok) {
      throw new Error(`signed URL download failed: ${response.status}`);
    }
  });

  it("cross-org signing is denied (no existence leak)", async () => {
    const path = `${orgA}/${crypto.randomUUID()}/${crypto.randomUUID()}/secret.xlsx`;
    await uploadForOrg(ownerAClient, path);
    const foreign = await ownerBClient.storage.from("questionnaires").createSignedUrl(path, 60);
    if (foreign.error === null && foreign.data?.signedUrl) {
      throw new Error("Org B obtained a signed URL for Org A's object");
    }
  });
});
