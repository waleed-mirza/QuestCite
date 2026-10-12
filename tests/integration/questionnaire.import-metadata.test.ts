/**
 * Migration 0013 contract: questionnaire_files.metadata (CSV delimiter/BOM
 * transport metadata) is validated at INSERT time inside
 * create_questionnaire_upload — csv uploads must carry { delimiter, bom },
 * xlsx uploads must carry {}, nothing else is accepted, and the persisted
 * values are readable back by org members. Runs against the linked hosted
 * project through real clients (D016).
 */

import { afterAll, beforeAll, describe, it } from "vitest";

import type { Database } from "@/types/database.types";

import { expectErrorWithCode, expectOk, expectRows } from "./helpers/assert";
import { createOrgAs, createTestUser, disposeAll, signInAs, type TestUser } from "./helpers/fixtures";

type Client = Awaited<ReturnType<typeof signInAs>>;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CSV_MIME = "text/csv";

let owner!: TestUser;
let ownerClient!: Client;
let orgId = "";

function createUpload(
  client: Client,
  args: Partial<Database["public"]["Functions"]["create_questionnaire_upload"]["Args"]> & {
    p_mime_type: string;
  },
) {
  return client.rpc("create_questionnaire_upload", {
    p_organization_id: orgId,
    p_title: "Metadata fixture",
    p_customer: "",
    p_due_date: null,
    p_filename: "q.xlsx",
    p_byte_size: 1024,
    p_checksum_sha256: "c".repeat(64),
    ...args,
  } as Database["public"]["Functions"]["create_questionnaire_upload"]["Args"]);
}

async function metadataOf(client: Client, questionnaireId: string): Promise<unknown> {
  const row = await client
    .from("questionnaire_files")
    .select("metadata")
    .eq("questionnaire_id", questionnaireId)
    .single();
  expectRows({ data: row.data !== null ? [row.data] : [], error: row.error }, "file row readable");
  return (row.data as { metadata: unknown } | null)?.metadata;
}

beforeAll(async () => {
  owner = await createTestUser("qmeta-owner", { fullName: "Metadata Owner" });
  ownerClient = await signInAs(owner);
  orgId = await createOrgAs(ownerClient, "Metadata Org", `qmeta-org-${Date.now().toString(36)}`);
});

afterAll(async () => {
  await disposeAll();
});

describe("create_questionnaire_upload metadata (migration 0013)", () => {
  it("persists csv delimiter/BOM metadata and reads it back", async () => {
    const { data, error } = await createUpload(ownerClient, {
      p_filename: "questions.csv",
      p_mime_type: CSV_MIME,
      p_metadata: { delimiter: ";", bom: true },
    });
    expectOk({ data, error }, "csv create with metadata");
    const row = (data as Array<{ questionnaire_id: string }> | null)?.[0];
    const metadata = await metadataOf(ownerClient, row?.questionnaire_id ?? "");
    // Compare structurally — jsonb does not preserve key order.
    if (
      metadata === null || typeof metadata !== "object"
      || (metadata as { delimiter?: string }).delimiter !== ";"
      || (metadata as { bom?: boolean }).bom !== true
    ) {
      throw new Error(`metadata not persisted: ${JSON.stringify(metadata)}`);
    }
  });

  it("keeps the xlsx default empty (backward-compatible omission)", async () => {
    const { data, error } = await createUpload(ownerClient, { p_mime_type: XLSX_MIME });
    expectOk({ data, error }, "xlsx create without metadata param");
    const row = (data as Array<{ questionnaire_id: string }> | null)?.[0];
    const metadata = await metadataOf(ownerClient, row?.questionnaire_id ?? "");
    if (JSON.stringify(metadata) !== "{}") {
      throw new Error(`xlsx metadata should be empty object: ${JSON.stringify(metadata)}`);
    }
  });

  it("rejects csv uploads without the delimiter/bom pair (parse-before-import invariant)", async () => {
    expectErrorWithCode(
      await createUpload(ownerClient, { p_mime_type: CSV_MIME }),
      "QUESTIONNAIRE_INPUT_INVALID",
      "csv without metadata",
    );
    expectErrorWithCode(
      await createUpload(ownerClient, { p_mime_type: CSV_MIME, p_metadata: { delimiter: "," } }),
      "QUESTIONNAIRE_INPUT_INVALID",
      "csv missing bom",
    );
  });

  it("rejects malformed metadata shapes", async () => {
    expectErrorWithCode(
      await createUpload(ownerClient, { p_mime_type: CSV_MIME, p_metadata: { delimiter: "!!", bom: true } }),
      "QUESTIONNAIRE_INPUT_INVALID",
      "unsupported delimiter",
    );
    expectErrorWithCode(
      await createUpload(ownerClient, { p_mime_type: CSV_MIME, p_metadata: { delimiter: ",", bom: "yes" } }),
      "QUESTIONNAIRE_INPUT_INVALID",
      "non-boolean bom",
    );
    expectErrorWithCode(
      await createUpload(ownerClient, {
        p_mime_type: CSV_MIME,
        p_metadata: { delimiter: ",", bom: true, encoding: "utf-8" },
      }),
      "QUESTIONNAIRE_INPUT_INVALID",
      "key outside the allowed set",
    );
    expectErrorWithCode(
      await createUpload(ownerClient, { p_mime_type: CSV_MIME, p_metadata: "comma" }),
      "QUESTIONNAIRE_INPUT_INVALID",
      "non-object metadata",
    );
  });

  it("rejects xlsx uploads that try to carry csv metadata", async () => {
    expectErrorWithCode(
      await createUpload(ownerClient, { p_mime_type: XLSX_MIME, p_metadata: { delimiter: ",", bom: false } }),
      "QUESTIONNAIRE_INPUT_INVALID",
      "xlsx with csv metadata",
    );
  });
});
