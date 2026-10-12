/**
 * Week 6 review/export/notification matrix (plan §W6 + AGENTS rule 7):
 *
 * - answer version history is trigger-captured on every content write and
 *   pruned to the newest 50; status-only changes add no versions.
 * - questionnaire lifecycle (active↔in_review→completed→exported) follows the
 *   D010/D012/D021/D023 rules: completing requires every question
 *   export-eligible, exporting freezes answers, invalid transitions fail.
 * - bulk review is all-or-nothing over strict pre-states; a cross-tenant id
 *   or a moved status rejects the WHOLE batch with nothing written.
 * - approve-vs-edit races resolve to exactly one winner (revision guard) and
 *   an approved answer that is subsequently edited loses its approval.
 * - export history rows assert a path-verified object and are member-readable;
 *   exports reuse the 0010 storage object shape (policy-proven by upload).
 * - notifications target the accountable people minus the actor; a user sees
 *   and marks-read ONLY their own rows; direct inserts are denied.
 * - audit completeness: status changes, bulk batches, reviewer assignment,
 *   lifecycle moves, and exports each land an audit event.
 *
 * Runs against the linked hosted project through real clients (D016).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/types/database.types";

import { expectError, expectErrorWithCode, expectNoRows, expectOk } from "./helpers/assert";
import { getAdminClient, getAnonClient } from "./helpers/clients";
import { provisionAnswer, provisionQuestionnaire, trackQuestionnaireStoragePath } from "./helpers/questionnaires";
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
let admin!: ReturnType<typeof getAdminClient>;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Generated RPC arg types cannot express NULLABLE Postgres parameters (the
 * documented limitation the W4 suite handles with one reviewed assertion per
 * affected RPC). These wrappers hold that assertion for the two NULL paths
 * the W6 flows exercise: clearing a reviewer and the genuine-create save.
 */
type SetReviewerArgs = Omit<
  Database["public"]["Functions"]["set_questionnaire_reviewer"]["Args"],
  "p_reviewer_id"
> & { p_reviewer_id: string | null };
type SaveAnswerArgs = Omit<
  Database["public"]["Functions"]["save_answer"]["Args"],
  "p_expected_revision"
> & { p_expected_revision: number | null };

function setReviewer(client: Client, args: SetReviewerArgs) {
  return client.rpc(
    "set_questionnaire_reviewer",
    args as Database["public"]["Functions"]["set_questionnaire_reviewer"]["Args"],
  );
}

function saveAnswer(client: Client, args: SaveAnswerArgs) {
  return client.rpc("save_answer", args as Database["public"]["Functions"]["save_answer"]["Args"]);
}

beforeAll(async () => {
  anon = getAnonClient();
  admin = getAdminClient();

  ownerA = await createTestUser("w6-owner-a", { fullName: "Owner A" });
  adminA = await createTestUser("w6-admin-a", { fullName: "Admin A" });
  reviewerA = await createTestUser("w6-reviewer-a", { fullName: "Reviewer A" });
  viewerA = await createTestUser("w6-viewer-a", { fullName: "Viewer A" });
  ownerB = await createTestUser("w6-owner-b", { fullName: "Owner B" });

  ownerAClient = await signInAs(ownerA);
  adminAClient = await signInAs(adminA);
  reviewerAClient = await signInAs(reviewerA);
  viewerAClient = await signInAs(viewerA);
  ownerBClient = await signInAs(ownerB);

  orgA = await createOrgAs(ownerAClient, "W6 Org A", `w6-org-a-${Date.now().toString(36)}`);
  orgB = await createOrgAs(ownerBClient, "W6 Org B", `w6-org-b-${Date.now().toString(36)}`);

  await addMember(orgA, adminA.userId, "admin");
  await addMember(orgA, reviewerA.userId, "reviewer");
  await addMember(orgA, viewerA.userId, "viewer");
});

afterAll(async () => {
  await disposeAll();
});

// ---------------------------------------------------------------------------
// Answer version history (trigger-captured content trail)
// ---------------------------------------------------------------------------

describe("answer version history", () => {
  it("captures the first save and every text edit, but not status-only changes", async () => {
    const { questionIds } = await provisionQuestionnaire({
      organizationId: orgA,
      questionCount: 1,
    });
    const questionId = questionIds[0] as string;

    // Direct fixture insert fires the snapshot trigger → version 1.
    const answerId = await provisionAnswer({ organizationId: orgA, questionId, text: "First draft." });

    // Manual edit through the real RPC → version 2.
    expectOk(
      await ownerAClient.rpc("save_answer", {
        p_organization_id: orgA,
        p_question_id: questionId,
        p_text: "Second draft, edited.",
        p_expected_revision: 1,
      }),
      "save_answer v2",
    );

    // Status-only transition → NO new version.
    expectOk(
      await ownerAClient.rpc("set_answer_status", {
        p_organization_id: orgA,
        p_question_id: questionId,
        p_status: "in_review",
        p_expected_revision: 2,
      }),
      "submit for review",
    );

    const { data: versions, error } = await reviewerAClient
      .from("answer_versions")
      .select("version_number, text, revision, creator_type")
      .eq("answer_id", answerId)
      .order("version_number", { ascending: true });
    expectOk({ data: versions, error }, "list versions");
    expect(versions?.length, "exactly two content versions").toBe(2);
    expect(versions?.[0]).toMatchObject({ version_number: 1, text: "First draft.", revision: 1 });
    expect(versions?.[1]).toMatchObject({ version_number: 2, text: "Second draft, edited.", revision: 2 });
  });

  it("never records a version for the empty insufficient_evidence marker", async () => {
    const { questionIds } = await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 });
    const answerId = await provisionAnswer({
      organizationId: orgA,
      questionId: questionIds[0] as string,
      text: "",
      status: "insufficient_evidence",
    });

    const { data: versions } = await ownerAClient
      .from("answer_versions")
      .select("id")
      .eq("answer_id", answerId);
    expect(versions?.length ?? 0, "abstention markers carry no content history").toBe(0);
  });

  it("keeps only the newest 50 versions per answer", async () => {
    const { questionIds } = await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 });
    const questionId = questionIds[0] as string;
    const answerId = await provisionAnswer({ organizationId: orgA, questionId, text: "Version 1." });

    // Service-role text edits drive the trigger 55 more times (fixture path —
    // the app itself never bulk-rewrites history).
    for (let round = 2; round <= 56; round += 1) {
      const { error } = await admin
        .from("answers")
        .update({ current_text: `Rewrite number ${round}.` })
        .eq("id", answerId);
      if (error !== null) {
        throw new Error(`prune fixture update ${round} failed: ${error.message}`);
      }
    }

    const { data: versions, error } = await ownerAClient
      .from("answer_versions")
      .select("version_number, text")
      .eq("answer_id", answerId)
      .order("version_number", { ascending: true });
    expectOk({ data: versions, error }, "list pruned versions");
    expect(versions?.length, "history capped at 50").toBe(50);
    expect(versions?.[0]?.version_number, "oldest survivor").toBe(7);
    expect(versions?.[49]?.text, "newest kept").toBe("Rewrite number 56.");
  }, 30_000);

  it("denies other tenants and anon any view of the history", async () => {
    const { questionIds } = await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 });
    const answerId = await provisionAnswer({ organizationId: orgA, questionId: questionIds[0] as string });

    expectNoRows(await ownerBClient.from("answer_versions").select("id").eq("answer_id", answerId), "org B read");
    expectNoRows(await anon.from("answer_versions").select("id").eq("answer_id", answerId), "anon read");

    const { data: own } = await viewerAClient.from("answer_versions").select("id").eq("answer_id", answerId);
    expect(own?.length, "org members (incl. viewers) can read").toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Questionnaire lifecycle: reviewer assignment + status transitions
// ---------------------------------------------------------------------------

describe("questionnaire reviewer + lifecycle", () => {
  it("assigns an O/A/R reviewer, notifies them, audits, and rejects outsiders", async () => {
    const { questionnaireId } = await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 });

    expectOk(
      await ownerAClient.rpc("set_questionnaire_reviewer", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_reviewer_id: adminA.userId,
      }),
      "assign reviewer",
    );

    const { data: assigned } = await ownerAClient
      .from("questionnaires")
      .select("assigned_reviewer")
      .eq("id", questionnaireId)
      .single();
    expect(assigned?.assigned_reviewer, "reviewer persisted").toBe(adminA.userId);

    // The new reviewer got exactly one assignment notification; the actor did not.
    const { data: notes } = await adminAClient
      .from("notifications")
      .select("type, user_id")
      .eq("questionnaire_id", questionnaireId)
      .eq("organization_id", orgA);
    expect(notes?.length, "one notification").toBe(1);
    expect(notes?.[0]).toMatchObject({ type: "questionnaire.assigned", user_id: adminA.userId });

    // Viewer is not a valid reviewer; owner B does not exist in org A.
    expectErrorWithCode(
      await ownerAClient.rpc("set_questionnaire_reviewer", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_reviewer_id: viewerA.userId,
      }),
      "ASSIGNEE_INVALID",
      "viewer as reviewer",
    );
    expectErrorWithCode(
      await ownerAClient.rpc("set_questionnaire_reviewer", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_reviewer_id: ownerB.userId,
      }),
      "ASSIGNEE_INVALID",
      "outsider as reviewer",
    );
    // Unassigning (NULL) is allowed.
    expectOk(
      await setReviewer(ownerAClient, {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_reviewer_id: null,
      }),
      "clear reviewer",
    );

    const { data: audit } = await ownerAClient
      .from("audit_events")
      .select("action")
      .eq("entity_id", questionnaireId)
      .eq("action", "questionnaire.reviewer_set");
    expect(audit?.length ?? 0, "reviewer assignment audited (set + clear)").toBe(2);
  });

  it("walks active → in_review → completed only when every question is export-eligible", async () => {
    const { questionnaireId, questionIds } = await provisionQuestionnaire({
      organizationId: orgA,
      questionCount: 2,
    });
    const [q1, q2] = questionIds as [string, string];
    await provisionAnswer({ organizationId: orgA, questionId: q1, text: "Answered." });

    expectOk(
      await ownerAClient.rpc("set_questionnaire_status", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_status: "in_review",
      }),
      "submit for review",
    );

    // q2 is still empty → completing must refuse (D012/D021/D023).
    expectErrorWithCode(
      await ownerAClient.rpc("set_questionnaire_status", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_status: "completed",
      }),
      "QUESTIONNAIRE_NOT_RESOLVED",
      "complete with empty question",
    );

    // A drafted AI answer blocks completion just the same.
    await provisionAnswer({ organizationId: orgA, questionId: q2, text: "AI draft.", status: "drafted" });
    expectErrorWithCode(
      await ownerAClient.rpc("set_questionnaire_status", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_status: "completed",
      }),
      "QUESTIONNAIRE_NOT_RESOLVED",
      "complete with drafted question",
    );

    // Resolve q2 with a conscious blank → completion succeeds (D021).
    expectOk(
      await ownerAClient.rpc("set_question_blank_by_choice", {
        p_organization_id: orgA,
        p_question_ids: [q2],
        p_value: true,
      }),
      "mark blank by choice",
    );
    expectOk(
      await ownerAClient.rpc("set_questionnaire_status", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_status: "completed",
      }),
      "complete with blank",
    );

    const { data: row } = await ownerAClient
      .from("questionnaires")
      .select("status")
      .eq("id", questionnaireId)
      .single();
    expect(row?.status, "completed").toBe("completed");

    // Reopen path: completed → in_review → active.
    expectOk(
      await ownerAClient.rpc("set_questionnaire_status", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_status: "in_review",
      }),
      "reopen to in_review",
    );
    expectOk(
      await ownerAClient.rpc("set_questionnaire_status", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_status: "active",
      }),
      "back to active",
    );

    const { data: audit } = await ownerAClient
      .from("audit_events")
      .select("action, metadata")
      .eq("entity_id", questionnaireId)
      .eq("action", "questionnaire.status_changed");
    expect(audit?.length ?? 0, "four human lifecycle moves audited").toBe(4);
  });

  it("rejects invalid jumps, cross-tenant calls, viewers, and anon", async () => {
    const { questionnaireId } = await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 });

    expectErrorWithCode(
      await ownerAClient.rpc("set_questionnaire_status", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_status: "completed",
      }),
      "QUESTIONNAIRE_STATE_INVALID",
      "active → completed jump",
    );
    expectErrorWithCode(
      await ownerAClient.rpc("set_questionnaire_status", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_status: "exported",
      }),
      "QUESTIONNAIRE_STATE_INVALID",
      "exported is export-only",
    );

    const { questionnaireId: foreignId } = await provisionQuestionnaire({
      organizationId: orgB,
      questionCount: 1,
    });
    expectErrorWithCode(
      await ownerAClient.rpc("set_questionnaire_status", {
        p_organization_id: orgB,
        p_questionnaire_id: foreignId,
        p_status: "in_review",
      }),
      "FORBIDDEN",
      "non-member of org B",
    );
    expectErrorWithCode(
      await viewerAClient.rpc("set_questionnaire_status", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_status: "in_review",
      }),
      "FORBIDDEN",
      "viewer transition",
    );
    // Anon has no EXECUTE grant at all (0018 revokes it) — the denial is the
    // grant layer, not the RPC's own guard.
    expectErrorWithCode(
      await anon.rpc("set_questionnaire_status", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_status: "in_review",
      }),
      "permission denied",
      "anon transition",
    );
  });
});

// ---------------------------------------------------------------------------
// Bulk review: strict pre-states, all-or-nothing, races
// ---------------------------------------------------------------------------

describe("bulk review", () => {
  it("submits answered answers and approves in_review ones, setting the approver", async () => {
    const { questionIds } = await provisionQuestionnaire({ organizationId: orgA, questionCount: 3 });
    const [q1, q2, q3] = questionIds as [string, string, string];
    await provisionAnswer({ organizationId: orgA, questionId: q1, text: "One." });
    await provisionAnswer({ organizationId: orgA, questionId: q2, text: "Two." });
    await provisionAnswer({ organizationId: orgA, questionId: q3, text: "Three." });

    expectOk(
      await ownerAClient.rpc("bulk_set_answer_status", {
        p_organization_id: orgA,
        p_question_ids: [q1, q2, q3],
        p_status: "in_review",
      }),
      "bulk submit",
    );

    const { data: submitted } = await ownerAClient
      .from("questions")
      .select("id, status")
      .in("id", [q1, q2, q3]);
    expect(submitted?.every((q) => q.status === "in_review"), "all three submitted").toBe(true);

    // Approve two of them as the reviewer.
    expectOk(
      await reviewerAClient.rpc("bulk_set_answer_status", {
        p_organization_id: orgA,
        p_question_ids: [q1, q2],
        p_status: "approved",
      }),
      "bulk approve",
    );
    const { data: answers } = await ownerAClient
      .from("answers")
      .select("question_id, status, approved_by")
      .in("question_id", [q1, q2, q3]);
    const byQuestion = new Map((answers ?? []).map((a) => [a.question_id, a]));
    expect(byQuestion.get(q1)).toMatchObject({ status: "approved", approved_by: reviewerA.userId });
    expect(byQuestion.get(q2)).toMatchObject({ status: "approved", approved_by: reviewerA.userId });
    expect(byQuestion.get(q3)).toMatchObject({ status: "in_review" });

    const { data: audit } = await ownerAClient
      .from("audit_events")
      .select("action, metadata")
      .eq("action", "answer.bulk_status_changed");
    expect(audit?.length ?? 0, "both batches audited").toBeGreaterThanOrEqual(2);
  });

  it("is atomic: one moved status rejects the whole batch with nothing written", async () => {
    const { questionIds } = await provisionQuestionnaire({ organizationId: orgA, questionCount: 2 });
    const [q1, q2] = questionIds as [string, string];
    await provisionAnswer({ organizationId: orgA, questionId: q1, text: "Ready." });
    await provisionAnswer({ organizationId: orgA, questionId: q2, text: "Already submitted.", status: "in_review" });

    expectErrorWithCode(
      await ownerAClient.rpc("bulk_set_answer_status", {
        p_organization_id: orgA,
        p_question_ids: [q1, q2],
        p_status: "in_review",
      }),
      "ANSWER_BULK_STATE_CHANGED",
      "mixed pre-states",
    );

    const { data: answers } = await ownerAClient
      .from("answers")
      .select("question_id, status, revision")
      .in("question_id", [q1, q2]);
    const byQuestion = new Map((answers ?? []).map((a) => [a.question_id, a]));
    expect(byQuestion.get(q1), "q1 untouched").toMatchObject({ status: "answered", revision: 1 });
    expect(byQuestion.get(q2), "q2 untouched").toMatchObject({ status: "in_review", revision: 1 });
  });

  it("rejects cross-tenant and unknown ids without writing anything", async () => {
    const { questionIds } = await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 });
    const foreign = await provisionQuestionnaire({ organizationId: orgB, questionCount: 1 });
    await provisionAnswer({ organizationId: orgA, questionId: questionIds[0] as string, text: "Mine." });
    await provisionAnswer({ organizationId: orgB, questionId: foreign.questionIds[0] as string, text: "Theirs." });

    expectErrorWithCode(
      await ownerAClient.rpc("bulk_set_answer_status", {
        p_organization_id: orgA,
        p_question_ids: [questionIds[0] as string, foreign.questionIds[0] as string],
        p_status: "in_review",
      }),
      "ANSWER_BULK_STATE_CHANGED",
      "cross-tenant id in batch",
    );
    const { data: mine } = await ownerAClient
      .from("answers")
      .select("status")
      .eq("question_id", questionIds[0] as string)
      .single();
    expect(mine?.status, "own answer untouched").toBe("answered");
  });

  it("keeps approve-vs-edit races consistent: exactly one wins", async () => {
    const { questionIds } = await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 });
    const questionId = questionIds[0] as string;
    await provisionAnswer({ organizationId: orgA, questionId, text: "Pre-review text." });

    // Both carry revision 1 → the revision guard lets exactly one land.
    const [edit, approve] = await Promise.all([
      ownerAClient.rpc("save_answer", {
        p_organization_id: orgA,
        p_question_id: questionId,
        p_text: "Concurrent edit text.",
        p_expected_revision: 1,
      }),
      reviewerAClient.rpc("set_answer_status", {
        p_organization_id: orgA,
        p_question_id: questionId,
        p_status: "approved",
        p_expected_revision: 1,
      }),
    ]);

    const editWon = edit.error === null;
    const approveWon = approve.error === null;
    expect(editWon !== approveWon, "exactly one concurrent write wins").toBe(true);
    if (!editWon) expect(edit.error?.message).toContain("ANSWER_CONFLICT");
    if (!approveWon) expect(approve.error?.message).toContain("ANSWER_CONFLICT");

    const { data: answer } = await ownerAClient
      .from("answers")
      .select("status, current_text, revision, approved_by")
      .eq("question_id", questionId)
      .single();

    if (editWon) {
      expect(answer, "edit landed, still unapproved").toMatchObject({
        status: "answered",
        current_text: "Concurrent edit text.",
        revision: 2,
        approved_by: null,
      });
    } else {
      expect(answer, "approval landed on the reviewed text").toMatchObject({
        status: "approved",
        current_text: "Pre-review text.",
        revision: 2,
      });
    }
  });

  it("demotes an approved answer when it is edited afterwards", async () => {
    const { questionIds } = await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 });
    const questionId = questionIds[0] as string;
    await provisionAnswer({ organizationId: orgA, questionId, text: "Approved text.", status: "in_review" });

    expectOk(
      await reviewerAClient.rpc("set_answer_status", {
        p_organization_id: orgA,
        p_question_id: questionId,
        p_status: "approved",
        p_expected_revision: 1,
      }),
      "approve",
    );
    expectOk(
      await ownerAClient.rpc("save_answer", {
        p_organization_id: orgA,
        p_question_id: questionId,
        p_text: "Edited after approval.",
        p_expected_revision: 2,
      }),
      "edit after approval",
    );

    const { data: answer } = await ownerAClient
      .from("answers")
      .select("status, approved_by, approved_at")
      .eq("question_id", questionId)
      .single();
    expect(answer, "approval invalidated by the edit").toMatchObject({
      status: "answered",
      approved_by: null,
      approved_at: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Export recording, history, and the exported freeze
// ---------------------------------------------------------------------------

describe("export history", () => {
  it("records an export, flips completed → exported, notifies, and audits", async () => {
    const { questionnaireId } = await provisionQuestionnaire({
      organizationId: orgA,
      questionCount: 2,
      status: "completed",
    });
    // Make the reviewer the accountable party so the notification fires.
    await admin
      .from("questionnaires")
      .update({ assigned_reviewer: reviewerA.userId })
      .eq("id", questionnaireId);

    const exportId = crypto.randomUUID();
    const filename = "fixture-questionnaire-answers.xlsx";
    const path = `${orgA}/${questionnaireId}/${exportId}/${filename}`;

    expectOk(
      await ownerAClient.rpc("record_questionnaire_export", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_export_id: exportId,
        p_storage_path: path,
        p_filename: filename,
        p_format: "xlsx",
        p_mime_type: XLSX_MIME,
        p_byte_size: 5432,
        p_checksum_sha256: "d".repeat(64),
        p_question_count: 2,
        p_approved_count: 1,
        p_blank_count: 1,
        p_written_cell_count: 2,
      }),
      "record export",
    );

    const { data: status } = await ownerAClient
      .from("questionnaires")
      .select("status")
      .eq("id", questionnaireId)
      .single();
    expect(status?.status, "completed → exported").toBe("exported");

    const { data: history } = await reviewerAClient
      .from("questionnaire_exports")
      .select("id, filename, checksum_sha256, question_count")
      .eq("questionnaire_id", questionnaireId);
    expect(history?.length, "history row readable by a reviewer").toBe(1);
    expect(history?.[0]).toMatchObject({ id: exportId, filename, checksum_sha256: "d".repeat(64) });

    const { data: notes } = await reviewerAClient
      .from("notifications")
      .select("type, user_id")
      .eq("questionnaire_id", questionnaireId)
      .eq("type", "questionnaire.exported");
    expect(notes?.every((n) => n.user_id === reviewerA.userId), "reviewer notified, actor not").toBe(true);

    const { data: audit } = await ownerAClient
      .from("audit_events")
      .select("action")
      .eq("entity_id", exportId)
      .eq("action", "questionnaire.exported");
    expect(audit?.length ?? 0, "export audited").toBe(1);

    // Re-export from exported is allowed (same frozen answers, new row).
    const secondId = crypto.randomUUID();
    expectOk(
      await ownerAClient.rpc("record_questionnaire_export", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_export_id: secondId,
        p_storage_path: `${orgA}/${questionnaireId}/${secondId}/${filename}`,
        p_filename: filename,
        p_format: "xlsx",
        p_mime_type: XLSX_MIME,
        p_byte_size: 5432,
        p_checksum_sha256: "e".repeat(64),
        p_question_count: 2,
        p_approved_count: 1,
        p_blank_count: 1,
        p_written_cell_count: 2,
      }),
      "re-export",
    );

    // Exported freezes answers (0010 editability window) — the state check
    // fires before any answer lookup, revision expectation or not.
    const { data: exportedQuestions } = await ownerAClient
      .from("questions")
      .select("id")
      .eq("questionnaire_id", questionnaireId);
    const firstExported = exportedQuestions?.[0]?.id;
    expect(firstExported).toBeDefined();
    expectErrorWithCode(
      await saveAnswer(ownerAClient, {
        p_organization_id: orgA,
        p_question_id: firstExported as string,
        p_text: "post-export edit",
        p_expected_revision: null,
      }),
      "QUESTIONNAIRE_STATE_INVALID",
      "answers frozen after export",
    );
  });

  it("refuses exports from non-completed states and forged paths", async () => {
    const { questionnaireId } = await provisionQuestionnaire({
      organizationId: orgA,
      questionCount: 1,
      status: "active",
    });

    expectErrorWithCode(
      await ownerAClient.rpc("record_questionnaire_export", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_export_id: crypto.randomUUID(),
        p_storage_path: `${orgA}/${questionnaireId}/${crypto.randomUUID()}/x.xlsx`,
        p_filename: "x.xlsx",
        p_format: "xlsx",
        p_mime_type: XLSX_MIME,
        p_byte_size: 100,
        p_checksum_sha256: "a".repeat(64),
        p_question_count: 1,
        p_approved_count: 0,
        p_blank_count: 0,
        p_written_cell_count: 1,
      }),
      "QUESTIONNAIRE_STATE_INVALID",
      "export from active",
    );

    const { questionnaireId: completedQn2 } = await provisionQuestionnaire({
      organizationId: orgA,
      questionCount: 1,
      status: "completed",
    });
    const completedId = crypto.randomUUID();
    expectErrorWithCode(
      await ownerAClient.rpc("record_questionnaire_export", {
        p_organization_id: orgA,
        p_questionnaire_id: completedQn2,
        p_export_id: completedId,
        // Path whose third segment does not match the row id — forged.
        p_storage_path: `${orgA}/${completedQn2}/${crypto.randomUUID()}/x.xlsx`,
        p_filename: "x.xlsx",
        p_format: "xlsx",
        p_mime_type: XLSX_MIME,
        p_byte_size: 100,
        p_checksum_sha256: "a".repeat(64),
        p_question_count: 1,
        p_approved_count: 0,
        p_blank_count: 0,
        p_written_cell_count: 1,
      }),
      "EXPORT_INPUT_INVALID",
      "path segment mismatch",
    );

    // Viewer cannot export; org B's owner cannot record into org A.
    const { questionnaireId: completedQn } = await provisionQuestionnaire({
      organizationId: orgA,
      questionCount: 1,
      status: "completed",
    });
    expectErrorWithCode(
      await viewerAClient.rpc("record_questionnaire_export", {
        p_organization_id: orgA,
        p_questionnaire_id: completedQn,
        p_export_id: crypto.randomUUID(),
        p_storage_path: `${orgA}/${completedQn}/${crypto.randomUUID()}/x.xlsx`,
        p_filename: "x.xlsx",
        p_format: "xlsx",
        p_mime_type: XLSX_MIME,
        p_byte_size: 100,
        p_checksum_sha256: "a".repeat(64),
        p_question_count: 1,
        p_approved_count: 0,
        p_blank_count: 0,
        p_written_cell_count: 1,
      }),
      "FORBIDDEN",
      "viewer export",
    );
    expectErrorWithCode(
      await ownerBClient.rpc("record_questionnaire_export", {
        p_organization_id: orgA,
        p_questionnaire_id: completedQn,
        p_export_id: crypto.randomUUID(),
        p_storage_path: `${orgA}/${completedQn}/${crypto.randomUUID()}/x.xlsx`,
        p_filename: "x.xlsx",
        p_format: "xlsx",
        p_mime_type: XLSX_MIME,
        p_byte_size: 100,
        p_checksum_sha256: "a".repeat(64),
        p_question_count: 1,
        p_approved_count: 0,
        p_blank_count: 0,
        p_written_cell_count: 1,
      }),
      "FORBIDDEN",
      "org B export into org A",
    );
    expectErrorWithCode(
      await ownerAClient.rpc("record_questionnaire_export", {
        p_organization_id: orgB,
        p_questionnaire_id: crypto.randomUUID(),
        p_export_id: crypto.randomUUID(),
        p_storage_path: `${orgB}/${crypto.randomUUID()}/${crypto.randomUUID()}/x.xlsx`,
        p_filename: "x.xlsx",
        p_format: "xlsx",
        p_mime_type: XLSX_MIME,
        p_byte_size: 100,
        p_checksum_sha256: "a".repeat(64),
        p_question_count: 1,
        p_approved_count: 0,
        p_blank_count: 0,
        p_written_cell_count: 1,
      }),
      "FORBIDDEN",
      "org A owner into org B",
    );
  });

  it("export objects inherit the questionnaire storage policies (real upload)", async () => {
    const { questionnaireId } = await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 });
    const exportId = crypto.randomUUID();
    const path = `${orgA}/${questionnaireId}/${exportId}/answers.xlsx`;
    trackQuestionnaireStoragePath(path);

    // The 0010 insert policy accepts O/A/R uploads at any valid 4-segment
    // path — export objects are ordinary objects of the same shape.
    const { error } = await reviewerAClient.storage.from("questionnaires").upload(path, new Uint8Array([1]), {
      contentType: XLSX_MIME,
    });
    expect(error, `upload should succeed: ${error?.message ?? ""}`).toBeNull();

    // A viewer can read it back through storage RLS (member-level select).
    const { error: readError } = await viewerAClient.storage.from("questionnaires").download(path);
    expect(readError, "member download works").toBeNull();

    // Org B cannot even see it.
    const { error: foreignError } = await ownerBClient.storage.from("questionnaires").download(path);
    expect(foreignError, "cross-tenant download denied").not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Notifications: own-rows visibility, read state, direct-insert denial
// ---------------------------------------------------------------------------

describe("notifications", () => {
  it("targets the accountable people and never the actor", async () => {
    const { questionnaireId, questionIds } = await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 });
    const questionId = questionIds[0] as string;
    // Reviewer authored the answer (already submitted); admin is the assignee; owner acts.
    await admin.from("questions").update({ assignee_id: adminA.userId }).eq("id", questionId);
    await provisionAnswer({
      organizationId: orgA,
      questionId,
      text: "Authored by the reviewer.",
      status: "in_review",
      createdBy: reviewerA.userId,
    });

    // Author is not the assignee or the questionnaire reviewer here.
    await admin.from("questionnaires").update({ assigned_reviewer: viewerA.userId }).eq("id", questionnaireId);

    expectOk(
      await ownerAClient.rpc("set_answer_status", {
        p_organization_id: orgA,
        p_question_id: questionId,
        p_status: "changes_requested",
        p_expected_revision: 1,
      }),
      "request changes",
    );

    const { data: targets } = await admin
      .from("notifications")
      .select("user_id, type")
      .eq("questionnaire_id", questionnaireId)
      .eq("type", "answer.changes_requested");
    const users = new Set((targets ?? []).map((n) => n.user_id));
    expect(users.has(adminA.userId), "assignee notified").toBe(true);
    expect(users.has(viewerA.userId), "questionnaire reviewer notified").toBe(true);
    expect(users.has(ownerA.userId), "actor never notified").toBe(false);
    expect(users.has(reviewerA.userId), "answer author notified").toBe(true);
  });

  it("shows a user only their own rows and allows marking only their own read", async () => {
    const { questionnaireId } = await provisionQuestionnaire({ organizationId: orgA, questionCount: 1 });
    await admin.from("questionnaires").update({ assigned_reviewer: adminA.userId }).eq("id", questionnaireId);

    // Trigger one notification for adminA only (owner is the actor).
    expectOk(
      await ownerAClient.rpc("set_questionnaire_reviewer", {
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireId,
        p_reviewer_id: adminA.userId,
      }),
      "reassign reviewer",
    );

    const { data: ownerView } = await ownerAClient
      .from("notifications")
      .select("id, user_id")
      .eq("organization_id", orgA);
    expect(
      (ownerView ?? []).every((n) => n.user_id === ownerA.userId),
      "owner sees only own rows (RLS filters the rest)",
    ).toBe(true);

    const { data: adminView } = await adminAClient
      .from("notifications")
      .select("id, user_id, read_at")
      .eq("organization_id", orgA)
      .eq("questionnaire_id", questionnaireId);
    const adminNote = adminView?.[0];
    expect(adminView?.length, "admin sees their own notification").toBe(1);
    expect(adminNote?.read_at).toBeNull();

    // Marking read works for the owner of the row…
    expectOk(
      await adminAClient.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", adminNote?.id ?? ""),
      "mark own read",
    );
    // …and silently does nothing for anyone else (RLS USING).
    await ownerAClient.from("notifications").update({ read_at: null }).eq("id", adminNote?.id ?? "");
    const { data: after } = await admin.from("notifications").select("read_at").eq("id", adminNote?.id ?? "").single();
    expect(after?.read_at, "foreign update ignored").not.toBeNull();
  });

  it("denies direct inserts and anon reads", async () => {
    expectError(
      await ownerAClient.from("notifications").insert({
        organization_id: orgA,
        user_id: ownerA.userId,
        type: "question.assigned",
        entity_type: "question",
      }),
      "no insert grant/policy",
    );
    expectNoRows(await anon.from("notifications").select("id").eq("organization_id", orgA), "anon read");
  });
});

// ---------------------------------------------------------------------------
// Audit completeness for the W6 sensitive actions
// ---------------------------------------------------------------------------

describe("audit completeness", () => {
  it("records export, lifecycle, reviewer, bulk, and transition events with no content", async () => {
    const { questionnaireId, questionIds } = await provisionQuestionnaire({
      organizationId: orgA,
      questionCount: 1,
      status: "completed",
    });
    const questionId = questionIds[0] as string;
    await provisionAnswer({ organizationId: orgA, questionId, text: "Audited text.", status: "in_review" });

    await reviewerAClient.rpc("set_answer_status", {
      p_organization_id: orgA,
      p_question_id: questionId,
      p_status: "approved",
      p_expected_revision: 2,
    });
    await ownerAClient.rpc("record_questionnaire_export", {
      p_organization_id: orgA,
      p_questionnaire_id: questionnaireId,
      p_export_id: crypto.randomUUID(),
      p_storage_path: `${orgA}/${questionnaireId}/${crypto.randomUUID()}/final.xlsx`,
      p_filename: "final.xlsx",
      p_format: "xlsx",
      p_mime_type: XLSX_MIME,
      p_byte_size: 999,
      p_checksum_sha256: "b".repeat(64),
      p_question_count: 1,
      p_approved_count: 1,
      p_blank_count: 0,
      p_written_cell_count: 1,
    });

    const { data: events } = await ownerAClient
      .from("audit_events")
      .select("action, entity_type, metadata")
      .eq("organization_id", orgA)
      .in("action", [
        "answer.status_changed",
        "answer.bulk_status_changed",
        "questionnaire.status_changed",
        "questionnaire.reviewer_set",
        "questionnaire.exported",
      ]);

    const actions = new Set((events ?? []).map((e) => e.action));
    for (const expected of [
      "answer.status_changed",
      "questionnaire.status_changed",
      "questionnaire.reviewer_set",
      "questionnaire.exported",
    ]) {
      expect(actions.has(expected), `audit has ${expected}`).toBe(true);
    }

    // Rule 8: audit metadata carries ids/counts/statuses — never answer text.
    for (const event of events ?? []) {
      const serialized = JSON.stringify(event.metadata);
      expect(serialized.includes("Audited text"), "no answer text in audit metadata").toBe(false);
    }
  });
});
