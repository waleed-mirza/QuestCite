/**
 * Questionnaire-workflow RLS matrix (plan §W4 + AGENTS rule 7): Org B cannot
 * read, mutate, or infer that Org A's questionnaires, questions, answers, or
 * comments exist; the permission matrix (owner/admin/revertiser write,
 * viewer read) and the RPC state machine (import → mapping → active; answer
 * transitions; revision conflicts) hold under real cross-tenant pressure.
 * Runs against the linked hosted project through real clients (D016).
 */

import { afterAll, beforeAll, describe, it } from "vitest";

import type { Database } from "@/types/database.types";

import { expectError, expectErrorWithCode, expectNoRows, expectOk, expectRows } from "./helpers/assert";
import {
  provisionAnswer,
  provisionQuestionnaire,
} from "./helpers/questionnaires";
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
let orgB = "";
let ownerA!: TestUser;
let adminA!: TestUser;
let reviewerA!: TestUser;
let viewerA!: TestUser;
let ownerB!: TestUser;
let ownerAClient!: Client;
let adminAClient!: Client;
let reviewerAClient!: Client;
let viewerAClient!: Client;
let ownerBClient!: Client;
let anon!: Client;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Generated RPC arg types cannot express NULLABLE Postgres parameters: a
 * nullable `date`/`integer` argument arrives typed as bare `string`/`number`
 * (the same documented limitation the W3 upload route handles with its one
 * reviewed assertion). The SQL accepts NULL — these wrappers hold exactly one
 * narrow, reviewed assertion per affected RPC so tests can exercise the real
 * NULL paths through the public API.
 */
type CreateUploadArgs = Omit<
  Database["public"]["Functions"]["create_questionnaire_upload"]["Args"],
  "p_due_date"
> & { p_due_date: string | null };
type SaveAnswerArgs = Omit<
  Database["public"]["Functions"]["save_answer"]["Args"],
  "p_expected_revision"
> & { p_expected_revision: number | null };
type SetAnswerStatusArgs = Omit<
  Database["public"]["Functions"]["set_answer_status"]["Args"],
  "p_expected_revision"
> & { p_expected_revision: number | null };

function createUpload(client: Client, args: CreateUploadArgs) {
  return client.rpc(
    "create_questionnaire_upload",
    args as Database["public"]["Functions"]["create_questionnaire_upload"]["Args"],
  );
}

function saveAnswer(client: Client, args: SaveAnswerArgs) {
  return client.rpc("save_answer", args as Database["public"]["Functions"]["save_answer"]["Args"]);
}

function setAnswerStatus(client: Client, args: SetAnswerStatusArgs) {
  return client.rpc("set_answer_status", args as Database["public"]["Functions"]["set_answer_status"]["Args"]);
}

function assignQuestions(
  client: Client,
  args: {
    p_organization_id: string;
    p_question_ids: string[];
    p_assignee_id: string | null;
  },
) {
  return client.rpc(
    "set_question_assignee",
    args as Database["public"]["Functions"]["set_question_assignee"]["Args"],
  );
}

/** A minimal valid mapping payload (mirrors what the app sends post-parse). */
function mappingQuestion(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    sheet_name: "Sheet1",
    row_number: "2",
    question_cell: "B2",
    answer_cell: "C2",
    question_original: "Is data encrypted at rest?",
    question_normalized: "Is data encrypted at rest?",
    category: "encryption",
    ...overrides,
  };
}

beforeAll(async () => {
  const { getAnonClient } = await import("./helpers/clients");
  anon = getAnonClient();

  ownerA = await createTestUser("qw-owner-a", { fullName: "Owner A" });
  adminA = await createTestUser("qw-admin-a", { fullName: "Admin A" });
  reviewerA = await createTestUser("qw-reviewer-a", { fullName: "Reviewer A" });
  viewerA = await createTestUser("qw-viewer-a", { fullName: "Viewer A" });
  ownerB = await createTestUser("qw-owner-b", { fullName: "Owner B" });

  ownerAClient = await signInAs(ownerA);
  adminAClient = await signInAs(adminA);
  reviewerAClient = await signInAs(reviewerA);
  viewerAClient = await signInAs(viewerA);
  ownerBClient = await signInAs(ownerB);

  orgA = await createOrgAs(ownerAClient, "QW Org A", `qw-org-a-${Date.now().toString(36)}`);
  orgB = await createOrgAs(ownerBClient, "QW Org B", `qw-org-b-${Date.now().toString(36)}`);
  await addMember(orgA, adminA.userId, "admin");
  await addMember(orgA, reviewerA.userId, "reviewer");
  await addMember(orgA, viewerA.userId, "viewer");
});

afterAll(async () => {
  await disposeAll();
});

describe("questionnaires / files / questions / answers / comments — cross-tenant reads", () => {
  let questionnaireA = "";
  let questionA = "";

  beforeAll(async () => {
    const provisioned = await provisionQuestionnaire({
      organizationId: orgA,
      title: "Org A Confidential Questionnaire",
      questionCount: 1,
    });
    questionnaireA = provisioned.questionnaireId;
    questionA = provisioned.questionIds[0] ?? "";
    await provisionAnswer({ organizationId: orgA, questionId: questionA, text: "Org A answer ZEBRA-5527" });
  });

  it("members of A read their own rows across every table", async () => {
    expectRows(await ownerAClient.from("questionnaires").select("*").eq("id", questionnaireA), "owner reads");
    expectRows(await reviewerAClient.from("questionnaire_files").select("*").eq("questionnaire_id", questionnaireA), "reviewer reads files");
    expectRows(await viewerAClient.from("questions").select("*").eq("id", questionA), "viewer reads questions");
    expectRows(await adminAClient.from("answers").select("*").eq("question_id", questionA), "admin reads answers");
  });

  it("question status starts empty and mirrors the answer status", async () => {
    const rows = await viewerAClient.from("questions").select("status").eq("id", questionA);
    const status = (rows.data as Array<{ status: string }> | null)?.[0]?.status;
    if (status !== "answered") {
      throw new Error(`expected denormalized question status "answered", got "${status}"`);
    }
  });

  it("Org B, and anonymous, see nothing of Org A (no existence leak)", async () => {
    expectNoRows(await ownerBClient.from("questionnaires").select("*").eq("id", questionnaireA), "B cannot read questionnaire");
    expectNoRows(await ownerBClient.from("questionnaire_files").select("*").eq("questionnaire_id", questionnaireA), "B cannot read files");
    expectNoRows(await ownerBClient.from("questions").select("*").eq("id", questionA), "B cannot read questions");
    expectNoRows(await ownerBClient.from("answers").select("*").eq("question_id", questionA), "B cannot read answers");
    expectNoRows(await anon.from("questionnaires").select("*").eq("id", questionnaireA), "anon cannot read");
    const probe = await ownerBClient.from("questionnaires").select("id").eq("id", questionnaireA);
    const missing = await ownerBClient.from("questionnaires").select("id").eq("id", crypto.randomUUID());
    expectNoRows(probe, "probe existing A questionnaire from B");
    expectNoRows(missing, "probe truly-missing id from B");
  });
});

describe("table write shapes per the permission matrix", () => {
  let questionnaireA = "";
  let questionA = "";

  beforeAll(async () => {
    const provisioned = await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 });
    questionnaireA = provisioned.questionnaireId;
    questionA = provisioned.questionIds[0] ?? "";
  });

  it("questions, files, and answers are RPC-only: direct writes denied for every role", async () => {
    expectError(
      await ownerAClient.from("questions").insert({
        questionnaire_id: questionnaireA,
        organization_id: orgA,
        position: 0,
        sheet_name: "Sheet1",
        row_number: 9,
        question_cell: "B9",
        question_original: "forged",
        question_normalized: "forged",
      }),
      "owner direct question insert",
    );
    expectError(
      await ownerAClient.from("questions").update({ category: "hijacked" }).eq("id", questionA),
      "owner direct question update",
    );
    expectError(
      await ownerAClient.from("answers").insert({
        question_id: questionA,
        organization_id: orgA,
        current_text: "forged",
        status: "approved",
        approved_by: ownerA.userId,
      }),
      "owner direct answer insert (self-approval forgery)",
    );
    expectError(
      await ownerAClient.from("answers").update({ status: "approved" }).eq("question_id", questionA),
      "owner direct answer update",
    );
    expectError(
      await reviewerAClient.from("questionnaire_files").update({ checksum_sha256: "0".repeat(64) }).eq("questionnaire_id", questionnaireA),
      "reviewer direct file update",
    );
  });

  it("questionnaire metadata edits are O/A/R; viewer is silently denied; delete is O/A only", async () => {
    expectRows(
      await reviewerAClient.from("questionnaires").update({ title: "Renamed by reviewer" }).eq("id", questionnaireA).select("id"),
      "reviewer metadata update",
    );
    expectNoRows(
      await viewerAClient.from("questionnaires").update({ title: "Hijack" }).eq("id", questionnaireA).select("id"),
      "viewer metadata update",
    );
    expectNoRows(
      await ownerBClient.from("questionnaires").update({ title: "Cross-tenant" }).eq("id", questionnaireA).select("id"),
      "B metadata update",
    );
    expectNoRows(
      await reviewerAClient.from("questionnaires").delete().eq("id", questionnaireA).select("id"),
      "reviewer delete",
    );
    expectOk(await ownerAClient.from("questionnaires").update({ title: "Restored title" }).eq("id", questionnaireA), "owner metadata update");
  });

  it("comments: O/A/R insert with own authorship; viewer denied; forging author or parent denied", async () => {
    expectRows(
      await reviewerAClient.from("comments").insert({
        organization_id: orgA,
        question_id: questionA,
        author_id: reviewerA.userId,
        body: "Reviewer note",
      }).select("id"),
      "reviewer comment",
    );
    expectError(
      await viewerAClient.from("comments").insert({
        organization_id: orgA,
        question_id: questionA,
        author_id: viewerA.userId,
        body: "viewer should not comment",
      }),
      "viewer comment",
    );
    expectError(
      await reviewerAClient.from("comments").insert({
        organization_id: orgA,
        question_id: questionA,
        author_id: ownerB.userId,
        body: "forged author",
      }),
      "forged author",
    );
    // A question from Org B — same org label on the comment row but a
    // question that belongs to another tenant must be rejected.
    const provisionedB = await provisionQuestionnaire({ organizationId: orgB, questionCount: 1 });
    expectError(
      await reviewerAClient.from("comments").insert({
        organization_id: orgA,
        question_id: provisionedB.questionIds[0] ?? "",
        author_id: reviewerA.userId,
        body: "cross-tenant question",
      }),
      "cross-tenant question comment",
    );
  });
});

describe("comment threading rules", () => {
  let questionA = "";
  let parentComment = "";

  beforeAll(async () => {
    const provisioned = await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 });
    questionA = provisioned.questionIds[0] ?? "";
    const inserted = await adminAClient
      .from("comments")
      .insert({ organization_id: orgA, question_id: questionA, author_id: adminA.userId, body: "Parent" })
      .select("id")
      .single();
    expectOk({ data: inserted.data, error: inserted.error }, "parent comment");
    parentComment = String((inserted.data as { id: string } | null)?.id);
  });

  it("replies attach inside the same question; a parent from another question is denied", async () => {
    expectRows(
      await reviewerAClient.from("comments").insert({
        organization_id: orgA,
        question_id: questionA,
        parent_id: parentComment,
        author_id: reviewerA.userId,
        body: "Reply",
      }).select("id"),
      "same-question reply",
    );
    const otherQuestion = (await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 })).questionIds[0] ?? "";
    expectError(
      await reviewerAClient.from("comments").insert({
        organization_id: orgA,
        question_id: otherQuestion,
        parent_id: parentComment,
        author_id: reviewerA.userId,
        body: "reply across questions",
      }),
      "cross-question parent",
    );
  });

  it("delete is author-or-owner/admin; other members denied", async () => {
    const ownComment = await reviewerAClient
      .from("comments")
      .insert({ organization_id: orgA, question_id: questionA, author_id: reviewerA.userId, body: "Self-deleted" })
      .select("id")
      .single();
    const ownId = String((ownComment.data as { id: string } | null)?.id);
    expectRows(await reviewerAClient.from("comments").delete().eq("id", ownId).select("id"), "author deletes own");
    const adminComment = await adminAClient
      .from("comments")
      .insert({ organization_id: orgA, question_id: questionA, author_id: adminA.userId, body: "Admin-authored" })
      .select("id")
      .single();
    const adminId = String((adminComment.data as { id: string } | null)?.id);
    expectNoRows(await reviewerAClient.from("comments").delete().eq("id", adminId).select("id"), "reviewer deletes admin's");
    expectRows(await adminAClient.from("comments").delete().eq("id", adminId).select("id"), "admin deletes admin's");
  });
});

describe("create_questionnaire_upload RPC", () => {
  it("O/A/R create with server-built org-prefixed paths", async () => {
    for (const [label, client] of [
      ["owner", ownerAClient],
      ["admin", adminAClient],
      ["reviewer", reviewerAClient],
    ] as const) {
      const { data, error } = await createUpload(client, {
        p_organization_id: orgA,
        p_title: `Imported by ${label}`,
        p_customer: "Acme Corp",
        p_due_date: "2026-12-31",
        p_filename: "questionnaire.xlsx",
        p_mime_type: XLSX_MIME,
        p_byte_size: 4096,
        p_checksum_sha256: "a".repeat(64),
      });
      expectOk({ data, error }, `${label} creates`);
      const row = (data as Array<{ questionnaire_id: string; file_id: string; storage_path: string }> | null)?.[0];
      if (!row?.storage_path.startsWith(`${orgA}/${row.questionnaire_id}/${row.file_id}/`)) {
        throw new Error(`storage path not server-built correctly: ${row?.storage_path}`);
      }
    }
    expectErrorWithCode(
      await createUpload(viewerAClient, {
        p_organization_id: orgA,
        p_title: "x",
        p_customer: "",
        p_due_date: null,
        p_filename: "q.xlsx",
        p_mime_type: XLSX_MIME,
        p_byte_size: 10,
        p_checksum_sha256: "a".repeat(64),
      }),
      "FORBIDDEN",
      "viewer import attempt",
    );
    expectErrorWithCode(
      await createUpload(ownerBClient, {
        p_organization_id: orgA,
        p_title: "cross",
        p_customer: "",
        p_due_date: null,
        p_filename: "q.xlsx",
        p_mime_type: XLSX_MIME,
        p_byte_size: 10,
        p_checksum_sha256: "a".repeat(64),
      }),
      "FORBIDDEN",
      "cross-org import attempt",
    );
  });

  it("rejects bad input with stable codes", async () => {
    const base = {
      p_organization_id: orgA,
      p_title: "Bad",
      p_customer: "",
      p_due_date: null,
      p_filename: "q.xlsx",
      p_mime_type: XLSX_MIME,
      p_byte_size: 10,
      p_checksum_sha256: "a".repeat(64),
    };
    expectErrorWithCode(
      await createUpload(ownerAClient, { ...base, p_mime_type: "application/zip" }),
      "QUESTIONNAIRE_TYPE_UNSUPPORTED",
      "bad mime",
    );
    expectErrorWithCode(
      await createUpload(ownerAClient, { ...base, p_byte_size: 11_000_000 }),
      "QUESTIONNAIRE_TOO_LARGE",
      "oversize",
    );
    expectErrorWithCode(
      await createUpload(ownerAClient, { ...base, p_byte_size: 0 }),
      "QUESTIONNAIRE_EMPTY",
      "empty",
    );
    expectErrorWithCode(
      await createUpload(ownerAClient, { ...base, p_filename: "../evil.xlsx" }),
      "QUESTIONNAIRE_INPUT_INVALID",
      "path traversal filename",
    );
    expectErrorWithCode(
      await createUpload(ownerAClient, { ...base, p_checksum_sha256: "nope" }),
      "QUESTIONNAIRE_INPUT_INVALID",
      "bad checksum",
    );
    expectErrorWithCode(
      await createUpload(ownerAClient, { ...base, p_title: "" }),
      "QUESTIONNAIRE_INPUT_INVALID",
      "empty title",
    );
    expectError(
      await createUpload(anon, { ...base }),
      "anon RPC",
    );
  });
});

describe("import lifecycle: mark_questionnaire_mapping + confirm_questionnaire_mapping", () => {
  let importingId = "";

  beforeAll(async () => {
    const created = await createUpload(ownerAClient, {
      p_organization_id: orgA,
      p_title: "Lifecycle fixture",
      p_customer: "Acme",
      p_due_date: null,
      p_filename: "q.xlsx",
      p_mime_type: XLSX_MIME,
      p_byte_size: 2048,
      p_checksum_sha256: "b".repeat(64),
    });
    importingId = (created.data as Array<{ questionnaire_id: string }> | null)?.[0]?.questionnaire_id ?? "";
    if (importingId === "") {
      throw new Error("lifecycle fixture questionnaire was not created");
    }
  });

  it("status starts importing; mapping latch is one-way", async () => {
    const before = await ownerAClient.from("questionnaires").select("status").eq("id", importingId).single();
    if ((before.data as { status: string } | null)?.status !== "importing") {
      throw new Error("expected importing status after create");
    }
    expectOk(await ownerAClient.rpc("mark_questionnaire_mapping", { p_organization_id: orgA, p_questionnaire_id: importingId }), "importing → mapping");
    expectErrorWithCode(
      await ownerAClient.rpc("mark_questionnaire_mapping", { p_organization_id: orgA, p_questionnaire_id: importingId }),
      "QUESTIONNAIRE_STATE_INVALID",
      "mapping latch is one-way",
    );
  });

  it("confirm inserts questions, activates the questionnaire, and records the parser version", async () => {
    const count = await ownerAClient.rpc("confirm_questionnaire_mapping", {
      p_organization_id: orgA,
      p_questionnaire_id: importingId,
      p_questions: [
        mappingQuestion(),
        mappingQuestion({ row_number: "3", question_cell: "B3", answer_cell: "C3", question_original: "Second question?", question_normalized: "Second question?" }),
      ],
      p_parser_version: "exceljs@4.4.0",
    });
    expectOk({ data: count, error: count.error }, "confirm");
    if (count.data !== 2) {
      throw new Error(`expected 2 questions imported, got ${String(count.data)}`);
    }
    const q = await ownerAClient.from("questionnaires").select("status").eq("id", importingId).single();
    if ((q.data as { status: string } | null)?.status !== "active") {
      throw new Error("expected active status after confirm");
    }
    const f = await ownerAClient.from("questionnaire_files").select("parser_version").eq("questionnaire_id", importingId).single();
    if ((f.data as { parser_version: string } | null)?.parser_version !== "exceljs@4.4.0") {
      throw new Error("parser version not persisted");
    }
    // Re-import after activation is a state error (questions are live now).
    expectErrorWithCode(
      await ownerAClient.rpc("confirm_questionnaire_mapping", {
        p_organization_id: orgA,
        p_questionnaire_id: importingId,
        p_questions: [mappingQuestion()],
        p_parser_version: "exceljs@4.4.0",
      }),
      "QUESTIONNAIRE_STATE_INVALID",
      "confirm after active",
    );
  });

  it("validation: shape, cell refs, duplicate cells, size limits — whole import rejected", async () => {
    const fresh = await createUpload(ownerAClient, {
      p_organization_id: orgA,
      p_title: "Validation fixture",
      p_customer: "",
      p_due_date: null,
      p_filename: "q.xlsx",
      p_mime_type: XLSX_MIME,
      p_byte_size: 1,
      p_checksum_sha256: "d".repeat(64),
    });
    const freshId = (fresh.data as Array<{ questionnaire_id: string }> | null)?.[0]?.questionnaire_id ?? "";
    if (freshId === "") {
      throw new Error("validation fixture missing");
    }

    const confirm = (questions: Array<Record<string, string>>, parserVersion = "exceljs@4.4.0") =>
      ownerAClient.rpc("confirm_questionnaire_mapping", {
        p_organization_id: orgA,
        p_questionnaire_id: freshId,
        p_questions: questions,
        p_parser_version: parserVersion,
      });

    expectErrorWithCode(await confirm([]), "MAPPING_INPUT_INVALID", "empty question list");
    expectErrorWithCode(await confirm([mappingQuestion({ question_cell: "not-a-cell" })]), "MAPPING_INPUT_INVALID", "bad cell ref");
    expectErrorWithCode(await confirm([mappingQuestion({ answer_cell: "c2" })]), "MAPPING_INPUT_INVALID", "lowercase cell ref");
    expectErrorWithCode(await confirm([mappingQuestion({ question_original: "" })]), "MAPPING_INPUT_INVALID", "empty question text");
    expectErrorWithCode(
      await confirm([mappingQuestion({ question_normalized: "x".repeat(4001) })]),
      "MAPPING_INPUT_INVALID",
      "oversize question text",
    );
    expectErrorWithCode(await confirm([mappingQuestion(), mappingQuestion()]), "MAPPING_DUPLICATE_CELL", "duplicate cell");
    expectErrorWithCode(await confirm([mappingQuestion()], "not a parser"), "MAPPING_INPUT_INVALID", "bad parser version");
    expectErrorWithCode(
      await confirm(Array.from({ length: 1001 }, (_, i) => mappingQuestion({ row_number: String(i + 2), question_cell: `B${i + 2}` }))),
      "MAPPING_INPUT_INVALID",
      "over the question limit",
    );

    // The whole import is transactional: no partial rows may exist.
    expectNoRows(await ownerAClient.from("questions").select("id").eq("questionnaire_id", freshId), "no partial questions after failures");
  });

  it("roles and tenancy: viewer denied, cross-org probe gets NOT_FOUND", async () => {
    const fresh = await createUpload(reviewerAClient, {
      p_organization_id: orgA,
      p_title: "Role fixture",
      p_customer: "",
      p_due_date: null,
      p_filename: "q.xlsx",
      p_mime_type: XLSX_MIME,
      p_byte_size: 1,
      p_checksum_sha256: "e".repeat(64),
    });
    const freshId = (fresh.data as Array<{ questionnaire_id: string }> | null)?.[0]?.questionnaire_id ?? "";
    expectErrorWithCode(
      await viewerAClient.rpc("confirm_questionnaire_mapping", {
        p_organization_id: orgA,
        p_questionnaire_id: freshId,
        p_questions: [mappingQuestion()],
        p_parser_version: "exceljs@4.4.0",
      }),
      "FORBIDDEN",
      "viewer confirm",
    );
    expectErrorWithCode(
      await ownerBClient.rpc("confirm_questionnaire_mapping", {
        p_organization_id: orgB,
        p_questionnaire_id: freshId,
        p_questions: [mappingQuestion()],
        p_parser_version: "exceljs@4.4.0",
      }),
      "QUESTIONNAIRE_NOT_FOUND",
      "B confirms A questionnaire",
    );
    expectErrorWithCode(
      await ownerBClient.rpc("mark_questionnaire_mapping", { p_organization_id: orgB, p_questionnaire_id: freshId }),
      "QUESTIONNAIRE_NOT_FOUND",
      "B marks A questionnaire",
    );
  });
});

describe("save_answer: autosave, revision conflicts, approval invalidation", () => {
  let questionA = "";

  beforeAll(async () => {
    const provisioned = await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 });
    questionA = provisioned.questionIds[0] ?? "";
  });

  it("first save creates an answered answer; question status syncs", async () => {
    const revision = await saveAnswer(reviewerAClient, {
      p_organization_id: orgA,
      p_question_id: questionA,
      p_text: "AES-256 at rest.",
      p_expected_revision: null,
    });
    expectOk({ data: revision, error: revision.error }, "first save");
    if (revision.data !== 1) {
      throw new Error(`expected revision 1, got ${String(revision.data)}`);
    }
    const status = await viewerAClient.from("questions").select("status").eq("id", questionA).single();
    if ((status.data as { status: string } | null)?.status !== "answered") {
      throw new Error("question status did not sync to answered");
    }
    // A stale create attempt (revision supplied but no row conflict...) — a
    // second first-save with a revision must conflict, not duplicate.
    expectErrorWithCode(
      await saveAnswer(adminAClient, {
        p_organization_id: orgA,
        p_question_id: questionA,
        p_text: "Different tab",
        p_expected_revision: null,
      }),
      "ANSWER_CONFLICT",
      "second tab create conflicts",
    );
  });

  it("stale revisions conflict; current revisions save", async () => {
    expectErrorWithCode(
      await saveAnswer(reviewerAClient, {
        p_organization_id: orgA,
        p_question_id: questionA,
        p_text: "Stale write",
        p_expected_revision: 99,
      }),
      "ANSWER_CONFLICT",
      "stale revision",
    );
    expectOk(
      await saveAnswer(reviewerAClient, {
        p_organization_id: orgA,
        p_question_id: questionA,
        p_text: "AES-256 at rest and TLS 1.3 in transit.",
        p_expected_revision: 1,
      }),
      "current revision save",
    );
    expectErrorWithCode(
      await saveAnswer(reviewerAClient, {
        p_organization_id: orgA,
        p_question_id: questionA,
        p_text: "",
        p_expected_revision: 2,
      }),
      "ANSWER_INPUT_INVALID",
      "blank text",
    );
  });

  it("editing an approved answer demotes it and clears the approval", async () => {
    expectOk(
      await setAnswerStatus(reviewerAClient, {
        p_organization_id: orgA,
        p_question_id: questionA,
        p_status: "in_review",
        p_expected_revision: 2,
      }),
      "submit for review",
    );
    const approved = await setAnswerStatus(reviewerAClient, {
      p_organization_id: orgA,
      p_question_id: questionA,
      p_status: "approved",
      p_expected_revision: 3,
    });
    expectOk({ data: approved, error: approved.error }, "approve (self-approval allowed, owner decision 2026-09-02)");
    if (approved.data !== 4) {
      throw new Error(`expected revision 4 after approve, got ${String(approved.data)}`);
    }
    const approvedRow = await ownerAClient.from("answers").select("approved_by, status").eq("question_id", questionA).single();
    const approvedData = approvedRow.data as { approved_by: string | null; status: string } | null;
    if (approvedData?.status !== "approved" || approvedData.approved_by === null) {
      throw new Error("expected approved answer with approver recorded");
    }

    expectOk(
      await saveAnswer(reviewerAClient, {
        p_organization_id: orgA,
        p_question_id: questionA,
        p_text: "Edited after approval.",
        p_expected_revision: 4,
      }),
      "edit approved answer",
    );
    const demoted = await ownerAClient.from("answers").select("status, approved_by, approved_at").eq("question_id", questionA).single();
    const demotedData = demoted.data as { status: string; approved_by: string | null; approved_at: string | null } | null;
    if (demotedData?.status !== "answered" || demotedData.approved_by !== null || demotedData.approved_at !== null) {
      throw new Error(`expected demoted answer, got ${JSON.stringify(demotedData)}`);
    }
  });

  it("state machine rejects invalid transitions and out-of-scope statuses", async () => {
    // answered → rejected skips review (rejected is only reachable from in_review).
    expectErrorWithCode(
      await setAnswerStatus(reviewerAClient, {
        p_organization_id: orgA,
        p_question_id: questionA,
        p_status: "rejected",
        p_expected_revision: 5,
      }),
      "ANSWER_TRANSITION_INVALID",
      "answered → rejected",
    );
    // AI-only statuses are not settable by humans.
    expectErrorWithCode(
      await setAnswerStatus(reviewerAClient, {
        p_organization_id: orgA,
        p_question_id: questionA,
        p_status: "drafted",
        p_expected_revision: 5,
      }),
      "ANSWER_TRANSITION_INVALID",
      "human sets drafted",
    );
    // Transitions require existing content.
    const fresh = (await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 })).questionIds[0] ?? "";
    expectErrorWithCode(
      await setAnswerStatus(reviewerAClient, {
        p_organization_id: orgA,
        p_question_id: fresh,
        p_status: "in_review",
        p_expected_revision: null,
      }),
      "ANSWER_NOT_FOUND",
      "transition without answer",
    );
  });

  it("roles, tenancy, and questionnaire state gates", async () => {
    expectErrorWithCode(
      await saveAnswer(viewerAClient, {
        p_organization_id: orgA,
        p_question_id: questionA,
        p_text: "viewer write",
        p_expected_revision: 5,
      }),
      "FORBIDDEN",
      "viewer save",
    );
    expectErrorWithCode(
      await saveAnswer(ownerBClient, {
        p_organization_id: orgB,
        p_question_id: questionA,
        p_text: "cross write",
        p_expected_revision: null,
      }),
      "QUESTION_NOT_FOUND",
      "B saves A question",
    );
    // A question inside a still-mapping questionnaire is not editable.
    const mappingQ = await provisionQuestionnaire({ organizationId: orgA, questionCount: 1, status: "mapping" });
    expectErrorWithCode(
      await saveAnswer(ownerAClient, {
        p_organization_id: orgA,
        p_question_id: mappingQ.questionIds[0] ?? "",
        p_text: "too early",
        p_expected_revision: null,
      }),
      "QUESTIONNAIRE_STATE_INVALID",
      "save during mapping",
    );
  });

  it("status changes are audited with from/to metadata only", async () => {
    expectOk(
      await setAnswerStatus(reviewerAClient, {
        p_organization_id: orgA,
        p_question_id: questionA,
        p_status: "in_review",
        p_expected_revision: 5,
      }),
      "resubmit",
    );
    const audits = await ownerAClient
      .from("audit_events")
      .select("action, metadata")
      .eq("action", "answer.status_changed")
      .order("created_at", { ascending: false })
      .limit(1);
    expectRows(audits, "audit row exists");
    const metadata = (audits.data as Array<{ metadata: { from?: string; to?: string } }> | null)?.[0]?.metadata;
    if (metadata?.to !== "in_review") {
      throw new Error(`expected audit metadata to=in_review, got ${JSON.stringify(metadata)}`);
    }
  });
});

describe("bulk question operations: assignee, blank_by_choice, category", () => {
  let q1 = "";
  let q2 = "";
  let qB = "";

  beforeAll(async () => {
    const provisionedA = await provisionQuestionnaire({ organizationId: orgA, questionCount: 2 });
    q1 = provisionedA.questionIds[0] ?? "";
    q2 = provisionedA.questionIds[1] ?? "";
    qB = (await provisionQuestionnaire({ organizationId: orgB, questionCount: 1 })).questionIds[0] ?? "";
  });

  it("bulk assignment to O/A/R members; viewers are invalid assignees", async () => {
    expectOk(
      await assignQuestions(ownerAClient, { p_organization_id: orgA, p_question_ids: [q1, q2], p_assignee_id: reviewerA.userId }),
      "assign reviewer",
    );
    const rows = await viewerAClient.from("questions").select("id, assignee_id").in("id", [q1, q2]);
    const assigned = (rows.data as Array<{ id: string; assignee_id: string | null }> | null) ?? [];
    if (assigned.length !== 2 || assigned.some((row) => row.assignee_id !== reviewerA.userId)) {
      throw new Error(`bulk assignment incomplete: ${JSON.stringify(assigned)}`);
    }
    expectErrorWithCode(
      await assignQuestions(ownerAClient, { p_organization_id: orgA, p_question_ids: [q1], p_assignee_id: viewerA.userId }),
      "ASSIGNEE_INVALID",
      "viewer assignee",
    );
    expectErrorWithCode(
      await assignQuestions(ownerAClient, { p_organization_id: orgA, p_question_ids: [q1], p_assignee_id: ownerB.userId }),
      "ASSIGNEE_INVALID",
      "non-member assignee",
    );
    expectOk(
      await assignQuestions(reviewerAClient, { p_organization_id: orgA, p_question_ids: [q1], p_assignee_id: null }),
      "unassign",
    );
    expectErrorWithCode(
      await assignQuestions(viewerAClient, { p_organization_id: orgA, p_question_ids: [q1], p_assignee_id: null }),
      "FORBIDDEN",
      "viewer bulk assign",
    );
  });

  it("bulk updates are atomic: one foreign id rejects the whole batch", async () => {
    expectErrorWithCode(
      await assignQuestions(ownerAClient, { p_organization_id: orgA, p_question_ids: [q1, qB], p_assignee_id: reviewerA.userId }),
      "QUESTION_NOT_FOUND",
      "batch with foreign id",
    );
    const rows = await ownerAClient.from("questions").select("id, assignee_id").eq("id", q1).single();
    if (((rows.data as { assignee_id: string | null } | null)?.assignee_id) !== null) {
      throw new Error("partial update leaked through an atomic rejection");
    }
  });

  it("blank_by_choice toggles in bulk (D012 conscious blanks)", async () => {
    expectOk(
      await adminAClient.rpc("set_question_blank_by_choice", { p_organization_id: orgA, p_question_ids: [q2], p_value: true }),
      "mark blank by choice",
    );
    const rows = await reviewerAClient.from("questions").select("id, blank_by_choice").eq("id", q2).single();
    if (((rows.data as { blank_by_choice: boolean } | null)?.blank_by_choice) !== true) {
      throw new Error("blank_by_choice not persisted");
    }
    expectOk(
      await reviewerAClient.rpc("set_question_blank_by_choice", { p_organization_id: orgA, p_question_ids: [q1, q2], p_value: false }),
      "bulk clear",
    );
    expectErrorWithCode(
      await ownerBClient.rpc("set_question_blank_by_choice", { p_organization_id: orgB, p_question_ids: [q1], p_value: true }),
      "QUESTION_NOT_FOUND",
      "B marks A question",
    );
  });

  it("category updates validate length and tenancy", async () => {
    expectOk(await reviewerAClient.rpc("update_question_category", { p_organization_id: orgA, p_question_id: q1, p_category: "network" }), "category set");
    expectErrorWithCode(
      await reviewerAClient.rpc("update_question_category", { p_organization_id: orgA, p_question_id: q1, p_category: "" }),
      "QUESTION_INPUT_INVALID",
      "empty category",
    );
    expectErrorWithCode(
      await reviewerAClient.rpc("update_question_category", { p_organization_id: orgA, p_question_id: q1, p_category: "x".repeat(81) }),
      "QUESTION_INPUT_INVALID",
      "oversize category",
    );
    expectErrorWithCode(
      await ownerBClient.rpc("update_question_category", { p_organization_id: orgB, p_question_id: q1, p_category: "cross" }),
      "QUESTION_NOT_FOUND",
      "B updates A question",
    );
  });
});
