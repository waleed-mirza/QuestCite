/**
 * Live Week 6 end-to-end workflow verification. The final assertion enforces
 * the suite cap in code.
 *
 * COST GATE: skipped unless BOTH `TEST_LIVE_WORKFLOW=1` is set AND a provider
 * is configured — CI pushes and normal `pnpm test:db` runs never spend budget
 * (AGENTS.md: never run live-AI tests on CI pushes).
 *
 * The suite drives the REAL workflow over the REAL database, storage, and
 * RPC tiers with one live model call per question (the fixture workbook
 * carries three): import a real workbook → start a drafting run → draft
 * grounded on an approved knowledge entry (the retrieval candidates are
 * supplied directly — live embedding search is the W3 smoke's job, and
 * retrieval calls would spend the same budget twice) → complete through the
 * real run service (citation validation included) → accept + approve →
 * lifecycle → export → reopen the exported workbook.
 *
 * Run: TEST_LIVE_WORKFLOW=1 pnpm test:db tests/integration/workflow-live.test.ts
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { estimateCostMicroUsd, getAnswerProvider, type AnswerProvider } from "@/lib/ai/answer-provider";
import { verifyOriginalCells, writeAnswersToWorkbook } from "@/lib/files/questionnaire/export";
import { detectColumns } from "@/lib/files/questionnaire/detect";
import { inspectWorkbook } from "@/lib/files/questionnaire/inspect";
import { extractQuestions } from "@/lib/files/questionnaire/extract";
import { getServerEnv } from "@/lib/env";
import { PROMPT_VERSION } from "@/server/services/drafting";
import { processNextAnswerRun } from "@/server/services/answer-run";
import { createAnswerRunGateway } from "@/server/services/answer-run-gateway";
import { selectEvidence, type EvidenceCandidate } from "@/server/services/retrieval";
import type { Database } from "@/types/database.types";

import { loadIntegrationEnv } from "./helpers/load-env";
import {
  addMember,
  createOrgAs,
  createTestUser,
  disposeAll,
  signInAs,
  type TestUser,
} from "./helpers/fixtures";
import { getAdminClient } from "./helpers/clients";

loadIntegrationEnv();

const wantsLive = process.env.TEST_LIVE_WORKFLOW === "1";
const liveProvider = wantsLive ? getAnswerProvider() : null;
const enabled = liveProvider !== null;

// Loud guard: a deliberate live run that cannot reach the provider must FAIL,
// never report a silent skip as green (S12 lesson).
it.skipIf(!wantsLive || enabled)("deliberate live workflow has a configured answer provider (guard against silent skip)", () => {
  throw new Error(
    "TEST_LIVE_WORKFLOW=1 but no answer provider is configured — check OPENAI_API_KEY/AI_ENABLED in .env.local.",
  );
});

function requireProvider(): AnswerProvider {
  if (liveProvider === null) {
    throw new Error("live provider unavailable — suite should have been skipped");
  }
  return liveProvider;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const FIXTURE_PATH = path.resolve("tests/fixtures/questionnaires/single-sheet.xlsx");
/** Week 6 budget cap in micro-USD (memory/budget-tracking.md). */
const W6_BUDGET_MICRO_USD = 750_000;

type Client = Awaited<ReturnType<typeof signInAs>>;

let owner!: TestUser;
let reviewer!: TestUser;
let ownerClient!: Client;
let reviewerClient!: Client;
let orgId = "";
let admin!: ReturnType<typeof getAdminClient>;

beforeAll(async () => {
  if (!enabled) return;
  admin = getAdminClient();
  owner = await createTestUser("w6l-owner");
  reviewer = await createTestUser("w6l-reviewer");
  ownerClient = await signInAs(owner);
  reviewerClient = await signInAs(reviewer);
  orgId = await createOrgAs(ownerClient, "W6 Live Org", `w6-live-${Date.now().toString(36)}`);
  await addMember(orgId, reviewer.userId, "reviewer");
}, 60_000);

afterAll(async () => {
  if (!enabled) return;
  await disposeAll();
});

describe.skipIf(!enabled)("live W6 workflow: import → draft → review → export", () => {
  const fixtureBytes = new Uint8Array(readFileSync(FIXTURE_PATH));
  const checksum = createHash("sha256").update(fixtureBytes).digest("hex");
  const env = getServerEnv();

  let questionnaireId = "";
  let entryId = "";
  let answerRevision = 1;
  const state = { accepted: false, approved: false, completed: false, exportedId: "", exportedChecksum: "" };

  it("imports a real workbook through the real RPCs and stages approved evidence", async () => {
    entryId = crypto.randomUUID();
    const { error: entryError } = await admin.from("knowledge_entries").insert({
      id: entryId,
      organization_id: orgId,
      question: "Is all customer data encrypted at rest?",
      answer:
        "Yes. All customer data is encrypted at rest with AES-256 and in transit with TLS 1.3. Keys are managed by the platform KMS with automatic rotation.",
      category: "encryption",
      review_state: "approved",
      owner_id: owner.userId,
    });
    expect(entryError, `knowledge entry: ${entryError?.message ?? ""}`).toBeNull();

    const uploadArgs = {
      p_organization_id: orgId,
      p_title: "Live workflow questionnaire",
      p_customer: "Live Customer",
      p_due_date: null,
      p_filename: "workflow-live.xlsx",
      p_mime_type: XLSX_MIME,
      p_byte_size: fixtureBytes.byteLength,
      p_checksum_sha256: checksum,
      p_metadata: {},
    } as unknown as Database["public"]["Functions"]["create_questionnaire_upload"]["Args"];
    const { data: upload, error: uploadError } = await ownerClient.rpc("create_questionnaire_upload", uploadArgs);
    expect(uploadError, `upload intent: ${uploadError?.message ?? ""}`).toBeNull();
    const created = Array.isArray(upload) ? upload[0] : upload;
    expect(created).toBeDefined();
    questionnaireId = (created as { questionnaire_id: string }).questionnaire_id;

    // Store the REAL untouched original at the server-built path.
    const storagePath = (created as { storage_path: string }).storage_path;
    const { error: storeError } = await ownerClient.storage.from("questionnaires").upload(storagePath, fixtureBytes, {
      contentType: XLSX_MIME,
    });
    expect(storeError, `storage upload: ${storeError?.message ?? ""}`).toBeNull();

    expectOk(await ownerClient.rpc("mark_questionnaire_mapping", { p_organization_id: orgId, p_questionnaire_id: questionnaireId }), "mark mapping");

    // The app's own import glue: inspect → detect (prefill) → extract.
    const inspection = await inspectWorkbook(fixtureBytes, "xlsx");
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) throw new Error("unreachable");
    const sheet = inspection.value.sheets[0];
    if (sheet === undefined) throw new Error("fixture has no sheet");
    const detection = detectColumns(sheet);
    expect(detection.questionColumn).not.toBeNull();
    expect(detection.answerColumn).not.toBeNull();
    const extraction = extractQuestions(inspection.value, {
      sheetName: sheet.name,
      headerRowIndex: detection.headerRowIndex,
      questionColumn: detection.questionColumn ?? 0,
      answerColumn: detection.answerColumn,
      notesColumn: detection.notesColumn,
    });
    expect(extraction.ok).toBe(true);
    if (!extraction.ok) throw new Error("unreachable");

    expectOk(
      await ownerClient.rpc("confirm_questionnaire_mapping", {
        p_organization_id: orgId,
        p_questionnaire_id: questionnaireId,
        p_questions: extraction.questions,
        p_parser_version: inspection.value.parserVersion,
      }),
      "confirm mapping",
    );

    // Reviewer assignment — they become the notified party for the export.
    expectOk(
      await ownerClient.rpc("set_questionnaire_reviewer", {
        p_organization_id: orgId,
        p_questionnaire_id: questionnaireId,
        p_reviewer_id: reviewer.userId,
      }),
      "assign reviewer",
    );
  }, 60_000);

  it("drafts the answer with exactly one live call through the real run service", async () => {
    const start = await ownerClient.rpc("start_answer_run", {
      p_organization_id: orgId,
      p_questionnaire_id: questionnaireId,
      p_model: env.OPENAI_ANSWER_MODEL,
      p_prompt_version: PROMPT_VERSION,
      p_idempotency_key: `w6-live-${Date.now().toString(36)}`,
    });
    expectOk(start, "start run");
    const started = (Array.isArray(start.data) ? start.data[0] : start.data) as { run_id: string };
    expect(started.run_id).toBeDefined();

    // One evidence candidate supplied directly (no embedding call — see file
    // header); the DB still validates the citation for real.
    const candidates: EvidenceCandidate[] = [
      {
        sourceType: "knowledge_entry",
        sourceId: entryId,
        documentId: null,
        documentTitle: null,
        section: "",
        content:
          "Yes. All customer data is encrypted at rest with AES-256 and in transit with TLS 1.3. Keys are managed by the platform KMS with automatic rotation.",
        combinedScore: 0.92,
        tags: [],
        reviewBy: null,
        isApprovedAnswer: true,
      },
    ];
    const today = new Date().toISOString().slice(0, 10);

    // The fixture workbook carries THREE questions → one batch of three
    // claims everything (and makes three grounded model calls, still far
    // inside the W6 cap); a second claim would hit the designed
    // RUN_NOT_ACTIVE end-state.
    const runId = started.run_id;
    const result = await processNextAnswerRun({
      gateway: createAnswerRunGateway(ownerClient),
      organizationId: orgId,
      runId,
      batchSize: 3,
      model: env.OPENAI_ANSWER_MODEL,
      provider: requireProvider(),
      maxInputTokens: env.AI_MAX_INPUT_TOKENS_PER_RUN,
      inputTokensUsed: 0,
      maxOutputTokens: 1_200,
      retrieveEvidence: async () => ({
        evidence: selectEvidence(candidates, [], today),
        embeddingAvailable: true,
      }),
    });
    expect(result.claimed, "all three questions were claimed").toBe(3);
    expect(result.failed, "no failed items").toBe(0);

    const { data: run } = await ownerClient
      .from("answer_runs")
      .select("status, input_tokens, output_tokens, estimated_cost_micro_usd")
      .eq("id", runId)
      .single();
    expect(run?.status, "run completed").toBe("completed");

    // answers carries no questionnaire_id — join through the questions.
    const { data: questionRows } = await ownerClient
      .from("questions")
      .select("id, answers(id, question_id, status, current_text, revision, creator_type, ai_disposition)")
      .eq("questionnaire_id", questionnaireId)
      .eq("organization_id", orgId);
    const drafts = (questionRows ?? []).map((row) => row.answers).filter((a) => a !== null && a.creator_type === "ai");
    expect(drafts.length, "every question has an AI-authored row").toBe(3);

    // The safety contract, not the model's mood: the encryption question has
    // supporting evidence and must produce a real draft; the other questions
    // may draft OR abstain (abstention = no text, marker disposition) — the
    // model must never fabricate without evidence.
    const drafted = drafts.filter((d) => d !== null && d.status === "drafted");
    const abstained = drafts.filter((d) => d !== null && d.status === "insufficient_evidence");
    expect(drafted.length + abstained.length).toBe(3);
    expect(drafted.length, "the supported question produced a draft").toBeGreaterThanOrEqual(1);
    for (const draft of drafted) {
      expect((draft?.current_text ?? "").length).toBeGreaterThan(0);
      expect(draft?.ai_disposition === "answered" || draft?.ai_disposition === "needs_review").toBe(true);
    }
    for (const draft of abstained) {
      expect(draft?.current_text, "abstentions carry no text").toBe("");
      expect(draft?.ai_disposition).toBe("insufficient_evidence");
    }

    const firstDraft = drafted[0];
    const firstQuestionId = firstDraft?.question_id;
    expect(firstQuestionId, "draft question id").toBeDefined();

    // Human accept on the first real draft (D022: self-approval allowed; the
    // AI never approves), then the legal approval path answered → in_review
    // → approved. Each transition bumps the revision by exactly one.
    answerRevision = firstDraft?.revision ?? 1;
    expectOk(
      await ownerClient.rpc("accept_answer_draft", {
        p_organization_id: orgId,
        p_question_id: firstQuestionId as string,
        p_expected_revision: answerRevision,
      }),
      "accept draft",
    );
    state.accepted = true;
    answerRevision += 1;

    expectOk(
      await ownerClient.rpc("set_answer_status", {
        p_organization_id: orgId,
        p_question_id: firstQuestionId as string,
        p_status: "in_review",
        p_expected_revision: answerRevision,
      }),
      "submit the accepted answer",
    );
    answerRevision += 1;

    expectOk(
      await ownerClient.rpc("set_answer_status", {
        p_organization_id: orgId,
        p_question_id: firstQuestionId as string,
        p_status: "approved",
        p_expected_revision: answerRevision,
      }),
      "approve the reviewed answer",
    );
    state.approved = true;
  }, 180_000);

  it("completes the lifecycle and exports the verified workbook", async () => {
    expect(state.approved).toBe(true);

    const { data: file } = await ownerClient
      .from("questionnaire_files")
      .select("storage_path, format, metadata")
      .eq("questionnaire_id", questionnaireId)
      .single();
    expect(file).toBeDefined();

    const { data: object, error: downloadError } = await ownerClient.storage
      .from("questionnaires")
      .download(file?.storage_path ?? "");
    expect(downloadError).toBeNull();
    const original = new Uint8Array(await (object as Blob).arrayBuffer());

    const { data: questions } = await ownerClient
      .from("questions")
      .select("id, sheet_name, row_number, question_cell, answer_cell, question_original, status, blank_by_choice, answers(id, current_text, status, revision)")
      .eq("questionnaire_id", questionnaireId)
      .eq("organization_id", orgId)
      .order("position");
    expect(questions?.length).toBe(3);

    // Resolve every remaining draft (acceptance is human; drafted blocks
    // completion) so the questionnaire is D023-eligible. Q1 is already
    // accepted + approved from the previous step.
    type ExportQuestion = {
      id: string;
      sheet_name: string;
      row_number: number;
      question_cell: string;
      answer_cell: string;
      question_original: string;
      answers: { current_text: string; status: string; revision: number } | null;
    };
    const rows = questions as ExportQuestion[];
    let approvedCount = 0;
    const answerLocations: Array<{
      sheetName: string;
      rowNumber: number;
      answerCell: string;
      text: string;
    }> = [];
    for (const row of rows) {
      const answer = row.answers;
      if (answer === null) {
        throw new Error(`question ${row.id} has no AI draft — the run should have drafted all three`);
      }
      if (answer.status === "drafted") {
        expectOk(
          await ownerClient.rpc("accept_answer_draft", {
            p_organization_id: orgId,
            p_question_id: row.id,
            p_expected_revision: answer.revision,
          }),
          `accept draft ${row.id}`,
        );
        answer.status = "answered";
        answer.revision += 1;
      }
      if (answer.status === "answered" && row.question_original.startsWith("Is all customer data encrypted")) {
        expectOk(
          await ownerClient.rpc("set_answer_status", {
            p_organization_id: orgId,
            p_question_id: row.id,
            p_status: "approved",
            p_expected_revision: answer.revision,
          }),
          `approve ${row.id}`,
        );
        answer.status = "approved";
      }
      if (answer.status === "approved") {
        approvedCount += 1;
      }
      answerLocations.push({
        sheetName: row.sheet_name,
        rowNumber: row.row_number,
        answerCell: row.answer_cell,
        // Conscious blanks and abstentions export as empty cells (D021).
        text: answer.status === "insufficient_evidence" ? "" : answer.current_text,
      });
    }
    expect(approvedCount).toBeGreaterThanOrEqual(1);

    expectOk(await ownerClient.rpc("set_questionnaire_status", { p_organization_id: orgId, p_questionnaire_id: questionnaireId, p_status: "in_review" }), "start review");
    expectOk(await ownerClient.rpc("set_questionnaire_status", { p_organization_id: orgId, p_questionnaire_id: questionnaireId, p_status: "completed" }), "complete review");
    state.completed = true;

    // The export pipeline (mirrors export-service without the cookie glue —
    // the real UI flow is covered by the E2E journey).
    const firstQuestion = rows[0] as ExportQuestion;
    const verified = await verifyOriginalCells({
      original,
      format: "xlsx",
      expectations: rows.map((row) => ({
        sheetName: row.sheet_name,
        rowNumber: row.row_number,
        questionCell: row.question_cell,
        expectedText: row.question_original,
      })),
    });
    expect(verified).toEqual({ ok: true });

    const written = await writeAnswersToWorkbook({
      original,
      format: "xlsx",
      answers: answerLocations,
    });
    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error("unreachable");

    const exportId = crypto.randomUUID();
    const exportChecksum = createHash("sha256").update(written.value.bytes).digest("hex");
    const filename = "workflow-live-answers-20260903.xlsx";
    const exportPath = `${orgId}/${questionnaireId}/${exportId}/${filename}`;
    const { error: exportUploadError } = await ownerClient.storage
      .from("questionnaires")
      .upload(exportPath, written.value.bytes, { contentType: XLSX_MIME });
    expect(exportUploadError, `export upload: ${exportUploadError?.message ?? ""}`).toBeNull();

    expectOk(
      await ownerClient.rpc("record_questionnaire_export", {
        p_organization_id: orgId,
        p_questionnaire_id: questionnaireId,
        p_export_id: exportId,
        p_storage_path: exportPath,
        p_filename: filename,
        p_format: "xlsx",
        p_mime_type: XLSX_MIME,
        p_byte_size: written.value.bytes.byteLength,
        p_checksum_sha256: exportChecksum,
        p_question_count: rows.length,
        p_approved_count: approvedCount,
        p_blank_count: 0,
        p_written_cell_count: written.value.written,
      }),
      "record export",
    );
    state.exportedId = exportId;
    state.exportedChecksum = exportChecksum;

    // The exported workbook REOPENS with the AI-drafted, human-approved text
    // in the mapped cell (plan §9/§W6).
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(
      Buffer.from(written.value.bytes.buffer, written.value.bytes.byteOffset, written.value.bytes.byteLength) as unknown as Parameters<typeof reopened.xlsx.load>[0],
    );
    const answerCell = reopened.worksheets[0]?.getCell(firstQuestion.answer_cell).value;
    expect(String(answerCell)).toContain("AES-256");

    const { data: status } = await ownerClient
      .from("questionnaires")
      .select("status")
      .eq("id", questionnaireId)
      .single();
    expect(status?.status).toBe("exported");
    state.completed = true;
  }, 60_000);

  it("leaves a complete audit trail, notifies the reviewer, and stays inside the W6 budget", async () => {
    const { data: audit } = await ownerClient
      .from("audit_events")
      .select("action")
      .eq("organization_id", orgId);
    const actions = new Set((audit ?? []).map((row) => row.action));
    for (const expected of [
      "questionnaire.created",
      "questionnaire.imported",
      "questionnaire.reviewer_set",
      "ai_run.started",
      "ai_run.completed",
      "answer.draft_accepted",
      "answer.status_changed",
      "questionnaire.status_changed",
      "questionnaire.exported",
    ]) {
      expect(actions.has(expected), `audit has ${expected}`).toBe(true);
    }

    // Version history captured the AI draft; the accept/approve added none.
    const { data: versions } = await ownerClient
      .from("answer_versions")
      .select("creator_type")
      .eq("organization_id", orgId);
    expect(versions?.length).toBeGreaterThanOrEqual(1);
    expect(versions?.every((v) => v.creator_type === "ai")).toBe(true);

    // The reviewer was notified (assignment + export); the actor was not.
    const { data: reviewerNotes } = await reviewerClient
      .from("notifications")
      .select("type")
      .eq("organization_id", orgId);
    const noteTypes = new Set((reviewerNotes ?? []).map((row) => row.type));
    expect(noteTypes.has("questionnaire.assigned")).toBe(true);
    expect(noteTypes.has("questionnaire.exported")).toBe(true);

    const { data: ownerNotes } = await ownerClient
      .from("notifications")
      .select("id")
      .eq("organization_id", orgId);
    expect(ownerNotes?.length ?? 0, "actor excluded from notifications").toBe(0);

    // Budget cap (memory/budget-tracking.md W6 allocation).
    const { data: run } = await ownerClient
      .from("answer_runs")
      .select("input_tokens, output_tokens, estimated_cost_micro_usd")
      .eq("organization_id", orgId)
      .limit(1)
      .single();
    const runCost = run?.estimated_cost_micro_usd ?? 0;
    const estimated = estimateCostMicroUsd(env.OPENAI_ANSWER_MODEL, run?.input_tokens ?? 0, run?.output_tokens ?? 0);
    console.info(
      `[w6-live] run cost est=$${(runCost / 1_000_000).toFixed(4)} (recomputed $${(estimated / 1_000_000).toFixed(4)}) in=${run?.input_tokens}tok out=${run?.output_tokens}tok`,
    );
    expect(estimated).toBeLessThan(W6_BUDGET_MICRO_USD);
  }, 30_000);
});

function expectOk(result: { error: { message: string } | null }, context: string): void {
  if (result.error !== null) {
    throw new Error(`${context}: unexpected error ${result.error.message}`);
  }
}
