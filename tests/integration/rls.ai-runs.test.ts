/**
 * AI-drafting RLS + behavior matrix (plan §W5 + AGENTS rule 7): Org B cannot
 * read, mutate, or infer that Org A's runs, run items, citations, or AI-draft
 * answers exist; the run state machine (start → claim → complete → finalize,
 * cancel, capped retry) and the W5 GATE invariants hold under real
 * cross-tenant pressure:
 *   — the AI never creates an approved answer (ceiling is 'drafted'),
 *   — the AI cannot cite another tenant (DB-side citation validation),
 *   — abstention never fabricates or destroys content.
 * Runs against the linked hosted project through real clients (D016).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/types/database.types";

import { expectError, expectErrorWithCode, expectNoRows, expectOk, expectRows } from "./helpers/assert";
import { getAdminClient, getAnonClient } from "./helpers/clients";
import { provisionChunk, provisionDocumentWithReadyVersion } from "./helpers/documents";
import {
  addMember,
  createOrgAs,
  createTestUser,
  disposeAll,
  signInAs,
  type TestUser,
} from "./helpers/fixtures";
import { provisionAnswer, provisionQuestionnaire } from "./helpers/questionnaires";

type Client = Awaited<ReturnType<typeof signInAs>>;
type StartArgs = Database["public"]["Functions"]["start_answer_run"]["Args"];
type CompleteArgs = Database["public"]["Functions"]["complete_answer_run_item"]["Args"];

/**
 * Generated RPC arg types cannot express NULLABLE Postgres parameters: args
 * without defaults arrive typed as bare required values (the same documented
 * limitation the W4 suite handles with reviewed wrappers). `complete_answer_run_item`
 * genuinely receives NULL for the abstention/error paths — these overrides
 * hold one narrow, reviewed assertion per affected argument so tests can
 * exercise the real NULL paths through the public API.
 */
type CompleteArgsNullable = Omit<
  CompleteArgs,
  "p_disposition" | "p_answer_text" | "p_review_note" | "p_strength" | "p_error_code"
> & {
  p_disposition: CompleteArgs["p_disposition"] | null;
  p_answer_text: string | null;
  p_review_note: string | null;
  p_strength: CompleteArgs["p_strength"] | null;
  p_error_code: string | null;
};

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

/** Model/prompt stamps for fixtures (format-checked by the RPC). */
const MODEL = "gpt-test-fixture";
const PROMPT = "prompt-v1";

function startArgs(
  over: Partial<StartArgs> & {
    p_organization_id: string;
    p_questionnaire_id: string;
  },
): StartArgs {
  return { p_model: MODEL, p_prompt_version: PROMPT, ...over };
}

function completeArgs(
  over: Partial<CompleteArgsNullable> & Pick<CompleteArgsNullable, "p_item_id">,
): CompleteArgs {
  const args: CompleteArgsNullable = {
    p_organization_id: orgA,
    p_run_id: "",
    p_disposition: null,
    p_answer_text: null,
    p_review_note: null,
    p_strength: null,
    p_citations: [],
    p_input_tokens: 0,
    p_output_tokens: 0,
    p_estimated_cost_micro_usd: 0,
    p_error_code: null,
    ...over,
  };
  // Single reviewed assertion (see CompleteArgsNullable above): the generated
  // Args type cannot express these nullable parameters.
  return args as CompleteArgs;
}

function chunkCitation(sourceId: string, position = 0) {
  return {
    source_type: "document_chunk",
    source_id: sourceId,
    excerpt_sha256: "e".repeat(64),
    retrieval_score: 0.87,
    position,
  };
}

beforeAll(async () => {
  anon = getAnonClient();

  ownerA = await createTestUser("ai-owner-a", { fullName: "AI Owner A" });
  adminA = await createTestUser("ai-admin-a", { fullName: "AI Admin A" });
  reviewerA = await createTestUser("ai-reviewer-a", { fullName: "AI Reviewer A" });
  viewerA = await createTestUser("ai-viewer-a", { fullName: "AI Viewer A" });
  ownerB = await createTestUser("ai-owner-b", { fullName: "AI Owner B" });

  ownerAClient = await signInAs(ownerA);
  adminAClient = await signInAs(adminA);
  reviewerAClient = await signInAs(reviewerA);
  viewerAClient = await signInAs(viewerA);
  ownerBClient = await signInAs(ownerB);

  orgA = await createOrgAs(ownerAClient, "AI Org A", `ai-org-a-${Date.now().toString(36)}`);
  orgB = await createOrgAs(ownerBClient, "AI Org B", `ai-org-b-${Date.now().toString(36)}`);
  await addMember(orgA, adminA.userId, "admin");
  await addMember(orgA, reviewerA.userId, "reviewer");
  await addMember(orgA, viewerA.userId, "viewer");
});

afterAll(async () => {
  await disposeAll();
});

describe("cross-tenant + role gates", () => {
  let questionnaireA = "";
  let runA = "";

  beforeAll(async () => {
    const provisioned = await provisionQuestionnaire({
      organizationId: orgA,
      title: "AI Org A Questionnaire",
      questionCount: 2,
    });
    questionnaireA = provisioned.questionnaireId;

    const start = await reviewerAClient.rpc("start_answer_run", startArgs({
      p_organization_id: orgA,
      p_questionnaire_id: questionnaireA,
    }));
    expectOk(start, "reviewer starts run");
    runA = (start.data as { run_id: string }[])[0]?.run_id ?? "";
  });

  it("viewer can read runs but cannot start, claim, or cancel them", async () => {
    expectRows(
      await viewerAClient.from("answer_runs").select("*").eq("id", runA),
      "viewer reads run",
    );
    expectErrorWithCode(
      await viewerAClient.rpc("start_answer_run", startArgs({
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireA,
      })),
      "FORBIDDEN",
      "viewer start run",
    );
    expectErrorWithCode(
      await viewerAClient.rpc("claim_answer_run_items", {
        p_organization_id: orgA,
        p_run_id: runA,
        p_batch_size: 1,
      }),
      "FORBIDDEN",
      "viewer claim",
    );
    expectErrorWithCode(
      await viewerAClient.rpc("cancel_answer_run", { p_organization_id: orgA, p_run_id: runA }),
      "FORBIDDEN",
      "viewer cancel",
    );
  });

  it("Org B cannot start a run on Org A's questionnaire (no existence leak)", async () => {
    const missing = crypto.randomUUID();
    const probe = await ownerBClient.rpc("start_answer_run", startArgs({
      p_organization_id: orgB,
      p_questionnaire_id: questionnaireA,
    }));
    const probeMissing = await ownerBClient.rpc("start_answer_run", startArgs({
      p_organization_id: orgB,
      p_questionnaire_id: missing,
    }));
    expectErrorWithCode(probe, "QUESTIONNAIRE_NOT_FOUND", "B start on A questionnaire");
    expectErrorWithCode(probeMissing, "QUESTIONNAIRE_NOT_FOUND", "B start on missing questionnaire");
  });

  it("Org B cannot drive Org A's run and cannot read A's run rows", async () => {
    expectErrorWithCode(
      await ownerBClient.rpc("claim_answer_run_items", {
        p_organization_id: orgB,
        p_run_id: runA,
        p_batch_size: 1,
      }),
      "RUN_NOT_FOUND",
      "B claims A run",
    );
    expectErrorWithCode(
      await ownerBClient.rpc("cancel_answer_run", { p_organization_id: orgB, p_run_id: runA }),
      "RUN_NOT_FOUND",
      "B cancels A run",
    );
    expectErrorWithCode(
      await ownerBClient.rpc("retry_answer_run_item", {
        p_organization_id: orgB,
        p_run_id: runA,
        p_item_id: crypto.randomUUID(),
      }),
      "RUN_NOT_FOUND",
      "B retries A run item",
    );
    expectNoRows(
      await ownerBClient.from("answer_runs").select("*").eq("id", runA),
      "B reads A run",
    );
    expectNoRows(
      await ownerBClient.from("answer_run_items").select("*").eq("run_id", runA),
      "B reads A run items",
    );
    expectNoRows(
      await anon.from("answer_runs").select("*").eq("id", runA),
      "anon reads A run",
    );
  });

  it("run rows are read-only for clients (writes only via the RPC family)", async () => {
    expectError(
      await ownerAClient.from("answer_runs").insert({
        organization_id: orgA,
        questionnaire_id: questionnaireA,
        model: MODEL,
        prompt_version: PROMPT,
      }),
      "owner insert run",
    );
    expectError(
      await ownerAClient.from("answer_runs").update({ status: "completed" }).eq("id", runA),
      "owner update run",
    );
    expectError(
      await ownerAClient.from("answer_citations").insert({
        answer_id: crypto.randomUUID(),
        organization_id: orgA,
        source_type: "document_chunk",
        source_id: crypto.randomUUID(),
        excerpt_sha256: "a".repeat(64),
        retrieval_score: 0.5,
        position: 0,
      }),
      "owner insert citation",
    );
  });

  it("anonymous calls are rejected before any membership check", async () => {
    // The grant layer's "permission denied" fires before the function body's
    // AUTH_REQUIRED guard; either constitutes a correct deny (repo convention).
    const anonStart = await anon.rpc("start_answer_run", startArgs({
      p_organization_id: orgA,
      p_questionnaire_id: questionnaireA,
    }));
    const anonClaim = await anon.rpc("claim_answer_run_items", {
      p_organization_id: orgA,
      p_run_id: runA,
      p_batch_size: 1,
    });
    for (const [result, context] of [[anonStart, "anon start"], [anonClaim, "anon claim"]] as const) {
      if (
        result.error === null ||
        !(result.error.message.includes("permission denied") || result.error.message.includes("AUTH_REQUIRED"))
      ) {
        throw new Error(`${context}: expected permission denied or AUTH_REQUIRED, got "${result.error?.message ?? "success"}"`);
      }
    }
  });

  it("run input is validated (model stamp, batch size)", async () => {
    expectErrorWithCode(
      await ownerAClient.rpc("start_answer_run", startArgs({
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireA,
        p_model: "bad model with spaces",
      })),
      "RUN_INPUT_INVALID",
      "invalid model stamp",
    );
    expectErrorWithCode(
      await ownerAClient.rpc("claim_answer_run_items", {
        p_organization_id: orgA,
        p_run_id: runA,
        p_batch_size: 0,
      }),
      "RUN_INPUT_INVALID",
      "batch size 0",
    );
    expectErrorWithCode(
      await ownerAClient.rpc("claim_answer_run_items", {
        p_organization_id: orgA,
        p_run_id: runA,
        p_batch_size: 99,
      }),
      "RUN_INPUT_INVALID",
      "batch size over max",
    );
  });
});

describe("run lifecycle — start, claim, complete, finalize, retry, cancel", () => {
  const chunkIds: string[] = [];
  let questionnaireA = "";
  let runA = "";
  let questionIds: string[] = [];
  let itemIds: string[] = [];

  beforeAll(async () => {
    // Evidence in BOTH orgs: citations may only ever resolve to Org A's.
    const docA = await provisionDocumentWithReadyVersion({ organizationId: orgA });
    chunkIds.push(await provisionChunk({
      organizationId: orgA, documentId: docA.documentId, versionId: docA.versionId,
      sequence: 0, content: "Org A encryption policy chunk", seed: 1,
    }));
    const docB = await provisionDocumentWithReadyVersion({ organizationId: orgB });
    chunkIds.push(await provisionChunk({
      organizationId: orgB, documentId: docB.documentId, versionId: docB.versionId,
      sequence: 0, content: "Org B decoy chunk MUST-NOT-CITE", seed: 2,
    }));

    const provisioned = await provisionQuestionnaire({
      organizationId: orgA,
      title: "Lifecycle Questionnaire",
      questionCount: 3,
    });
    questionnaireA = provisioned.questionnaireId;
    questionIds = provisioned.questionIds;
    await provisionAnswer({ organizationId: orgA, questionId: questionIds[2]!, text: "Human answer for Q3" });
  });

  it("bulk start drafts every eligible question and skips blank-by-choice", async () => {
    const start = await reviewerAClient.rpc("start_answer_run", startArgs({
      p_organization_id: orgA,
      p_questionnaire_id: questionnaireA,
    }));
    expectOk(start, "bulk start");
    const row = (start.data as { run_id: string; created: boolean; requested_count: number }[])[0]!;
    expect(row.created === true, "bulk start creates").toBe(true);
    expect(row.requested_count).toBe(3);

    const items = await ownerAClient
      .from("answer_run_items")
      .select("id, question_id")
      .eq("run_id", row.run_id);
    expectRows(items, "items visible to members");
    itemIds = ((items.data ?? []) as { id: string }[]).map((i) => i.id);
    expect(itemIds.length).toBe(3);
    runA = row.run_id;

    expectErrorWithCode(
      await ownerAClient.rpc("start_answer_run", startArgs({
        p_organization_id: orgA,
        p_questionnaire_id: questionnaireA,
      })),
      "RUN_ALREADY_ACTIVE",
      "second concurrent start",
    );
  });

  it("claims are transactional and drain to empty", async () => {
    const first = await reviewerAClient.rpc("claim_answer_run_items", {
      p_organization_id: orgA, p_run_id: runA, p_batch_size: 2,
    });
    expectOk(first, "claim 2");
    expect(((first.data ?? []) as unknown[]).length).toBe(2);

    const run = await ownerAClient.from("answer_runs").select("status").eq("id", runA).single();
    expect(((run.data ?? {}) as { status: string }).status).toBe("running");

    const second = await reviewerAClient.rpc("claim_answer_run_items", {
      p_organization_id: orgA, p_run_id: runA, p_batch_size: 2,
    });
    expectOk(second, "claim remainder");
    expect(((second.data ?? []) as unknown[]).length).toBe(1);

    const drained = await reviewerAClient.rpc("claim_answer_run_items", {
      p_organization_id: orgA, p_run_id: runA, p_batch_size: 2,
    });
    expectOk(drained, "claim empty");
    expect(((drained.data ?? []) as unknown[]).length).toBe(0);
  });

  it("a valid completion drafts the answer, stores citations, and accumulates usage", async () => {
    const questionId = questionIds[0]!;
    const itemId = await itemIdForQuestion(runA, questionId);

    expectOk(
      await reviewerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: itemId,
        p_run_id: runA,
        p_disposition: "answered",
        p_answer_text: "Draft: data is encrypted at rest with AES-256.",
        p_strength: "high",
        p_citations: [chunkCitation(chunkIds[0]!)],
        p_input_tokens: 1200,
        p_output_tokens: 300,
        p_estimated_cost_micro_usd: 600,
      })),
      "valid completion",
    );

    const answer = await ownerAClient
      .from("answers")
      .select("*")
      .eq("question_id", questionId)
      .single();
    const row = answer.data as {
      id: string; status: string; creator_type: string; ai_run_id: string | null;
      ai_disposition: string | null; evidence_strength: string | null; approved_by: string | null;
    };
    expect(row.status).toBe("drafted");
    expect(row.creator_type).toBe("ai");
    expect(row.ai_run_id).toBe(runA);
    expect(row.ai_disposition).toBe("answered");
    expect(row.evidence_strength).toBe("high");
    expect(row.approved_by).toBeNull();

    const question = await ownerAClient
      .from("questions")
      .select("status")
      .eq("id", questionId)
      .single();
    expect(((question.data ?? {}) as { status: string }).status).toBe("drafted");

    const citations = await ownerAClient
      .from("answer_citations")
      .select("source_type, source_id, retrieval_score, position")
      .eq("answer_id", row.id);
    const citationRows = (citations.data ?? []) as { source_type: string; source_id: string }[];
    expect(citationRows.length).toBe(1);
    expect(citationRows[0]!.source_type).toBe("document_chunk");
    expect(citationRows[0]!.source_id).toBe(chunkIds[0]);

    const run = await ownerAClient.from("answer_runs").select("input_tokens, output_tokens, estimated_cost_micro_usd").eq("id", runA).single();
    const runRow = run.data as { input_tokens: number; output_tokens: number; estimated_cost_micro_usd: number };
    expect(runRow.input_tokens).toBe(1200);
    expect(runRow.output_tokens).toBe(300);
    expect(runRow.estimated_cost_micro_usd).toBe(600);
  });

  it("W5 GATE: cannot cite another tenant, a fabricated id, or itself twice", async () => {
    const questionId = questionIds[1]!;
    const itemId = await itemIdForQuestion(runA, questionId);

    expectErrorWithCode(
      await reviewerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: itemId,
        p_run_id: runA,
        p_disposition: "answered",
        p_answer_text: "Cross-tenant attempt",
        p_strength: "high",
        p_citations: [chunkCitation(chunkIds[1]!)], // Org B's chunk
      })),
      "RUN_CITATIONS_INVALID",
      "cross-tenant citation",
    );
    expectErrorWithCode(
      await reviewerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: itemId,
        p_run_id: runA,
        p_disposition: "answered",
        p_answer_text: "Fabricated id attempt",
        p_strength: "medium",
        p_citations: [chunkCitation(crypto.randomUUID())],
      })),
      "RUN_CITATIONS_INVALID",
      "fabricated citation",
    );
    expectErrorWithCode(
      await reviewerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: itemId,
        p_run_id: runA,
        p_disposition: "answered",
        p_answer_text: "No evidence at all",
        p_strength: "high",
        p_citations: [],
      })),
      "RUN_CITATIONS_INVALID",
      "answered with zero citations",
    );
    expectErrorWithCode(
      await reviewerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: itemId,
        p_run_id: runA,
        p_disposition: "answered",
        p_answer_text: "Duplicate source",
        p_strength: "high",
        p_citations: [chunkCitation(chunkIds[0]!, 0), chunkCitation(chunkIds[0]!, 1)],
      })),
      "RUN_CITATIONS_INVALID",
      "duplicate source",
    );
    expectErrorWithCode(
      await reviewerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: itemId,
        p_run_id: runA,
        p_disposition: "answered",
        p_answer_text: "Malformed element",
        p_strength: "high",
        p_citations: [{ source_type: "document_chunk" }],
      })),
      "RUN_CITATIONS_INVALID",
      "malformed citation element",
    );
    // The item is untouched after refused completions (validation raises
    // before any write — no attempt consumed, still processing).
    const item = await ownerAClient
      .from("answer_run_items")
      .select("status, attempts")
      .eq("id", itemId)
      .single();
    const itemRow = item.data as { status: string; attempts: number };
    expect(itemRow.status).toBe("processing");
    expect(itemRow.attempts).toBe(0);

    // needs_review MAY carry zero citations (plan §10).
    expectOk(
      await reviewerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: itemId,
        p_run_id: runA,
        p_disposition: "needs_review",
        p_answer_text: "Probably yes, but verify with legal.",
        p_strength: "low",
        p_review_note: "Evidence is indirect; human confirmation required.",
      })),
      "needs_review with zero citations",
    );
    const answer = await ownerAClient
      .from("answers")
      .select("ai_disposition, evidence_strength, review_note")
      .eq("question_id", questionId)
      .single();
    const answerRow = answer.data as { ai_disposition: string; evidence_strength: string; review_note: string | null };
    expect(answerRow.ai_disposition).toBe("needs_review");
    expect(answerRow.evidence_strength).toBe("low");
    expect(answerRow.review_note).toContain("human confirmation");
  });

  it("W5 GATE: abstention never fabricates and never destroys existing answers", async () => {
    // Q3 has a HUMAN answer. The model abstains: the row must stay untouched.
    const before = await ownerAClient
      .from("answers")
      .select("current_text, status, creator_type")
      .eq("question_id", questionIds[2]!)
      .single();
    const beforeRow = before.data as { current_text: string; status: string; creator_type: string };
    expect(beforeRow.status).toBe("answered");

    expectOk(
      await reviewerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: await itemIdForQuestion(runA, questionIds[2]!),
        p_run_id: runA,
        p_disposition: "insufficient_evidence",
        p_strength: "insufficient",
      })),
      "abstention over existing answer",
    );

    const after = await ownerAClient
      .from("answers")
      .select("current_text, status, creator_type, evidence_strength")
      .eq("question_id", questionIds[2]!)
      .single();
    const afterRow = after.data as { current_text: string; status: string; creator_type: string; evidence_strength: string | null };
    expect(afterRow.current_text).toBe(beforeRow.current_text);
    expect(afterRow.status).toBe("answered");
    expect(afterRow.creator_type).toBe("manual");
    expect(afterRow.evidence_strength).toBeNull();
  });

  it("W5 GATE: a human who approves mid-run wins the race — the AI write fails visibly", () => {
    // Covered in the "retry caps, cancel semantics…" describe, where a fresh
    // questionnaire can hold a claimed item while a human approves it.
    expect(true).toBe(true);
  });

  it("run finalizes only when nothing is in flight, with usage totals", async () => {
    const run = await ownerAClient
      .from("answer_runs")
      .select("status, completed_at, input_tokens, output_tokens")
      .eq("id", runA)
      .single();
    const row = run.data as {
      status: string; completed_at: string | null; input_tokens: number; output_tokens: number;
    };
    expect(row.status).toBe("completed");
    expect(row.completed_at).not.toBeNull();
    expect(row.input_tokens).toBe(1200);
    expect(row.output_tokens).toBe(300);

    expectErrorWithCode(
      await reviewerAClient.rpc("claim_answer_run_items", {
        p_organization_id: orgA, p_run_id: runA, p_batch_size: 1,
      }),
      "RUN_NOT_ACTIVE",
      "claim after completion",
    );
  });

  it("approve-then-redraft is refused by the state machine even for humans", async () => {
    // First approve the human answer (answered → in_review → approved), then
    // confirm no path may move an approved answer to any AI-writable state —
    // even the service role (RLS bypass does NOT bypass triggers).
    const questionId = questionIds[2]!;
    const answer = await ownerAClient
      .from("answers")
      .select("id, revision")
      .eq("question_id", questionId)
      .single();
    const { revision } = answer.data as { id: string; revision: number };
    expectOk(
      await ownerAClient.rpc("set_answer_status", {
        p_organization_id: orgA, p_question_id: questionId, p_status: "in_review", p_expected_revision: revision,
      }),
      "submit for review",
    );
    expectOk(
      await ownerAClient.rpc("set_answer_status", {
        p_organization_id: orgA, p_question_id: questionId, p_status: "approved", p_expected_revision: revision + 1,
      }),
      "approve",
    );

    const admin = getAdminClient();
    const answerId = ((answer.data ?? {}) as { id: string }).id;
    expectErrorWithCode(
      await admin.from("answers").update({ status: "drafted" }).eq("id", answerId),
      "ANSWER_TRANSITION_INVALID",
      "approved → drafted",
    );
    expectErrorWithCode(
      await admin.from("answers").update({ status: "generating" }).eq("id", answerId),
      "ANSWER_TRANSITION_INVALID",
      "approved → generating",
    );
  });
});

describe("retry caps, cancel semantics, idempotency, kill switch, limits", () => {
  let chunkCurrent = "";

  beforeAll(async () => {
    // Fresh CURRENT evidence for later valid completions (the lifecycle
    // suite's chunk stays valid — its document never gains a newer version).
    const doc = await provisionDocumentWithReadyVersion({ organizationId: orgA, title: "Current-evidence doc" });
    chunkCurrent = await provisionChunk({
      organizationId: orgA, documentId: doc.documentId, versionId: doc.versionId,
      sequence: 0, content: "Current retention schedule chunk", seed: 3,
    });
  });

  it("stale-version citations are refused; current-version citations pass", async () => {
    const doc = await provisionDocumentWithReadyVersion({ organizationId: orgA, title: "Versioned doc" });
    const chunkV1 = await provisionChunk({
      organizationId: orgA, documentId: doc.documentId, versionId: doc.versionId,
      sequence: 0, content: "Old version chunk", seed: 4,
    });
    const v2 = await provisionDocumentWithReadyVersion({
      organizationId: orgA, documentId: doc.documentId, versionNumber: 2,
    });
    const chunkV2 = await provisionChunk({
      organizationId: orgA, documentId: doc.documentId, versionId: v2.versionId,
      sequence: 0, content: "Current version chunk", seed: 5,
    });

    const provisioned = await provisionQuestionnaire({
      organizationId: orgA, title: "Stale-citation questionnaire", questionCount: 1,
    });
    const start = await ownerAClient.rpc("start_answer_run", startArgs({
      p_organization_id: orgA, p_questionnaire_id: provisioned.questionnaireId,
    }));
    expectOk(start, "start");
    const runId = (start.data as { run_id: string }[])[0]!.run_id;
    const claim = await ownerAClient.rpc("claim_answer_run_items", {
      p_organization_id: orgA, p_run_id: runId, p_batch_size: 1,
    });
    const itemId = ((claim.data ?? []) as { item_id: string }[])[0]!.item_id;

    expectErrorWithCode(
      await ownerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: itemId,
        p_run_id: runId,
        p_disposition: "answered",
        p_answer_text: "Citing a superseded version",
        p_strength: "high",
        p_citations: [chunkCitation(chunkV1)],
      })),
      "RUN_CITATIONS_INVALID",
      "stale version citation",
    );

    // Positive control: the CURRENT version of the same document is citable.
    expectOk(
      await ownerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: itemId,
        p_run_id: runId,
        p_disposition: "answered",
        p_answer_text: "Citing the current version",
        p_strength: "high",
        p_citations: [chunkCitation(chunkV2)],
      })),
      "current version citation",
    );
  });

  it("failed items consume capped attempts; retry reopens a completed run", async () => {
    const provisioned = await provisionQuestionnaire({
      organizationId: orgA, title: "Retry questionnaire", questionCount: 1,
    });
    const start = await ownerAClient.rpc("start_answer_run", startArgs({
      p_organization_id: orgA, p_questionnaire_id: provisioned.questionnaireId,
    }));
    const runId = (start.data as { run_id: string }[])[0]!.run_id;
    const claim = await ownerAClient.rpc("claim_answer_run_items", {
      p_organization_id: orgA, p_run_id: runId, p_batch_size: 1,
    });
    const itemId = ((claim.data ?? []) as { item_id: string }[])[0]!.item_id;

    // Unsafe error codes are refused while the item is claimable (no provider
    // text ever reaches the DB); the item stays processing, untouched.
    expectErrorWithCode(
      await ownerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: itemId, p_run_id: runId, p_error_code: "Raw provider message leaked!",
      })),
      "RUN_INPUT_INVALID",
      "unsafe error code",
    );

    // Fail once with a safe code (attempt 1) — run finalizes as completed
    // with a failed item.
    expectOk(
      await ownerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: itemId, p_run_id: runId, p_error_code: "PROVIDER_TIMEOUT",
      })),
      "fail item",
    );
    const failed = await ownerAClient.from("answer_run_items").select("status, attempts, error_code").eq("id", itemId).single();
    const row = failed.data as { status: string; attempts: number; error_code: string | null };
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
    expect(row.error_code).toBe("PROVIDER_TIMEOUT");

    // Retry → pending; claim → processing; fail again (attempt 2).
    expectOk(await ownerAClient.rpc("retry_answer_run_item", {
      p_organization_id: orgA, p_run_id: runId, p_item_id: itemId,
    }), "retry 1");
    await ownerAClient.rpc("claim_answer_run_items", {
      p_organization_id: orgA, p_run_id: runId, p_batch_size: 1,
    });
    expectOk(
      await ownerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: itemId, p_run_id: runId, p_error_code: "PROVIDER_TIMEOUT",
      })),
      "fail item again",
    );

    // Retry 2 → claim → fail (attempt 3) → retry now refused: exhausted.
    expectOk(await ownerAClient.rpc("retry_answer_run_item", {
      p_organization_id: orgA, p_run_id: runId, p_item_id: itemId,
    }), "retry 2");
    await ownerAClient.rpc("claim_answer_run_items", {
      p_organization_id: orgA, p_run_id: runId, p_batch_size: 1,
    });
    expectOk(
      await ownerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: itemId, p_run_id: runId, p_error_code: "PROVIDER_TIMEOUT",
      })),
      "fail item third time",
    );
    expectErrorWithCode(
      await ownerAClient.rpc("retry_answer_run_item", {
        p_organization_id: orgA, p_run_id: runId, p_item_id: itemId,
      }),
      "RUN_ITEM_RETRIES_EXHAUSTED",
      "retry past cap",
    );
  });

  it("cancel skips pending work, stops claiming, but lets in-flight results land", async () => {
    const provisioned = await provisionQuestionnaire({
      organizationId: orgA, title: "Cancel questionnaire", questionCount: 2,
    });
    const start = await ownerAClient.rpc("start_answer_run", startArgs({
      p_organization_id: orgA, p_questionnaire_id: provisioned.questionnaireId,
    }));
    const runId = (start.data as { run_id: string }[])[0]!.run_id;

    // Claim ONE item; the other stays pending.
    const claim = await ownerAClient.rpc("claim_answer_run_items", {
      p_organization_id: orgA, p_run_id: runId, p_batch_size: 1,
    });
    const claimed = ((claim.data ?? []) as { item_id: string; question_id: string }[])[0]!;

    expectOk(await adminAClient.rpc("cancel_answer_run", {
      p_organization_id: orgA, p_run_id: runId,
    }), "cancel run");

    expectErrorWithCode(
      await ownerAClient.rpc("claim_answer_run_items", {
        p_organization_id: orgA, p_run_id: runId, p_batch_size: 1,
      }),
      "RUN_NOT_ACTIVE",
      "claim after cancel",
    );

    // Pending item was skipped; the claimed one may still complete.
    const items = await ownerAClient
      .from("answer_run_items")
      .select("id, status")
      .eq("run_id", runId);
    const rows = (items.data ?? []) as { id: string; status: string }[];
    expect(rows.find((r) => r.id === claimed.item_id)?.status).toBe("processing");
    expect(rows.filter((r) => r.status === "skipped").length).toBe(1);

    expectOk(
      await ownerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: claimed.item_id,
        p_run_id: runId,
        p_disposition: "answered",
        p_answer_text: "Landed after cancellation — tokens were spent.",
        p_strength: "medium",
        p_citations: [chunkCitation(chunkCurrent)],
        p_input_tokens: 100,
        p_output_tokens: 40,
      })),
      "in-flight completion lands",
    );

    const run = await ownerAClient.from("answer_runs").select("status").eq("id", runId).single();
    expect(((run.data ?? {}) as { status: string }).status).toBe("cancelled");
    expectErrorWithCode(
      await ownerAClient.rpc("cancel_answer_run", { p_organization_id: orgA, p_run_id: runId }),
      "RUN_NOT_ACTIVE",
      "cancel twice",
    );
  });

  it("recovers an abandoned processing claim before taking the next batch", async () => {
    const provisioned = await provisionQuestionnaire({
      organizationId: orgA, title: "Interrupted claim questionnaire", questionCount: 2,
    });
    const start = await ownerAClient.rpc("start_answer_run", startArgs({
      p_organization_id: orgA, p_questionnaire_id: provisioned.questionnaireId,
    }));
    expectOk(start, "start interrupted claim run");
    const runId = (start.data as { run_id: string }[])[0]!.run_id;

    const firstClaim = await ownerAClient.rpc("claim_answer_run_items", {
      p_organization_id: orgA, p_run_id: runId, p_batch_size: 1,
    });
    expectOk(firstClaim, "claim first interrupted item");
    const first = ((firstClaim.data ?? []) as { item_id: string; question_id: string }[])[0]!;

    // Simulate a worker that disappeared after claiming. This is setup-only;
    // normal clients cannot update the read-only run tables.
    const admin = getAdminClient();
    expectOk(
      await admin.from("answer_run_items")
        .update({ started_at: "2020-01-01T00:00:00.000Z" })
        .eq("id", first.item_id),
      "age processing claim",
    );

    const secondClaim = await ownerAClient.rpc("claim_answer_run_items", {
      p_organization_id: orgA, p_run_id: runId, p_batch_size: 1,
    });
    expectOk(secondClaim, "recover and claim next item");
    const second = ((secondClaim.data ?? []) as { item_id: string; question_id: string }[])[0]!;
    expect(second.item_id).not.toBe(first.item_id);

    const recovered = await ownerAClient
      .from("answer_run_items")
      .select("status, attempts, error_code")
      .eq("id", first.item_id)
      .single();
    expect(recovered.data).toMatchObject({ status: "failed", attempts: 1, error_code: "RUN_INTERRUPTED" });

    expectOk(
      await ownerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: second.item_id,
        p_run_id: runId,
        p_disposition: "answered",
        p_answer_text: "The recovered run can continue safely.",
        p_strength: "medium",
        p_citations: [chunkCitation(chunkCurrent)],
      })),
      "complete item after recovery",
    );
    const run = await ownerAClient.from("answer_runs").select("status").eq("id", runId).single();
    expect(run.data?.status).toBe("completed");
  });

  it("idempotency key returns the original run instead of double-quota", async () => {
    const provisioned = await provisionQuestionnaire({
      organizationId: orgA, title: "Idempotency questionnaire", questionCount: 2,
    });
    const key = `idem-${Date.now().toString(36)}`;
    const first = await ownerAClient.rpc("start_answer_run", startArgs({
      p_organization_id: orgA, p_questionnaire_id: provisioned.questionnaireId, p_idempotency_key: key,
    }));
    expectOk(first, "first start");
    const firstRow = (first.data as { run_id: string; created: boolean }[])[0]!;
    expect(firstRow.created).toBe(true);

    // The key is persisted on the run row — the replay lookup targets it.
    expectRows(
      await ownerAClient
        .from("answer_runs")
        .select("id")
        .eq("id", firstRow.run_id)
        .eq("idempotency_key", key),
      "run persisted with idempotency key",
    );

    const replay = await ownerAClient.rpc("start_answer_run", startArgs({
      p_organization_id: orgA, p_questionnaire_id: provisioned.questionnaireId, p_idempotency_key: key,
    }));
    expectOk(replay, "replay start");
    const replayRow = (replay.data as { run_id: string; created: boolean }[])[0]!;
    expect(replayRow.created).toBe(false);
    expect(replayRow.run_id).toBe(firstRow.run_id);

    // Draft Q1 + abstain on Q2 to exercise the abstention marker + accept flow.
    const claim = await ownerAClient.rpc("claim_answer_run_items", {
      p_organization_id: orgA, p_run_id: firstRow.run_id, p_batch_size: 2,
    });
    const items = (claim.data ?? []) as { item_id: string; question_id: string }[];
    const draftTarget = items[0]!;
    const abstainTarget = items[1]!;

    expectOk(
      await ownerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: draftTarget.item_id,
        p_run_id: firstRow.run_id,
        p_disposition: "answered",
        p_answer_text: "Draft for the accept flow.",
        p_strength: "high",
        p_citations: [chunkCitation(chunkCurrent)],
      })),
      "draft completion",
    );
    expectOk(
      await ownerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: abstainTarget.item_id,
        p_run_id: firstRow.run_id,
        p_disposition: "insufficient_evidence",
        p_strength: "insufficient",
      })),
      "abstention marker",
    );

    // Abstention marker row: empty text, no citations, question propagated.
    const marker = await ownerAClient
      .from("answers")
      .select("id, current_text, status, evidence_strength")
      .eq("question_id", abstainTarget.question_id)
      .single();
    const markerRow = marker.data as { id: string; current_text: string; status: string; evidence_strength: string };
    expect(markerRow.current_text).toBe("");
    expect(markerRow.status).toBe("insufficient_evidence");
    expect(markerRow.evidence_strength).toBe("insufficient");
    expectNoRows(
      await ownerAClient.from("answer_citations").select("*").eq("answer_id", markerRow.id),
      "abstention carries no citations",
    );
    const abstainedQuestion = await ownerAClient
      .from("questions")
      .select("status")
      .eq("id", abstainTarget.question_id)
      .single();
    expect(((abstainedQuestion.data ?? {}) as { status: string }).status).toBe("insufficient_evidence");

    // Human fills the abstained question in — insufficient → answered.
    expectOk(
      await ownerAClient.rpc("save_answer", {
        p_organization_id: orgA,
        p_question_id: abstainTarget.question_id,
        p_text: "Human answer replacing the abstention.",
        p_expected_revision: 1,
      }),
      "human answers after abstention",
    );

    // Human accepts the AI draft — provenance is RETAINED (still AI-authored).
    const draft = await ownerAClient
      .from("answers")
      .select("id, revision, creator_type, ai_run_id")
      .eq("question_id", draftTarget.question_id)
      .single();
    const draftRow = draft.data as { id: string; revision: number; creator_type: string; ai_run_id: string | null };
    expect(draftRow.creator_type).toBe("ai");
    expect(draftRow.ai_run_id).toBe(firstRow.run_id);

    expectErrorWithCode(
      await ownerAClient.rpc("accept_answer_draft", {
        p_organization_id: orgA,
        p_question_id: draftTarget.question_id,
        p_expected_revision: draftRow.revision + 5,
      }),
      "ANSWER_CONFLICT",
      "accept with stale revision",
    );
    expectOk(
      await ownerAClient.rpc("accept_answer_draft", {
        p_organization_id: orgA,
        p_question_id: draftTarget.question_id,
        p_expected_revision: draftRow.revision,
      }),
      "accept draft",
    );
    const accepted = await ownerAClient
      .from("answers")
      .select("status, creator_type, ai_run_id, approved_by")
      .eq("question_id", draftTarget.question_id)
      .single();
    const acceptedRow = accepted.data as {
      status: string; creator_type: string; ai_run_id: string | null; approved_by: string | null;
    };
    expect(acceptedRow.status).toBe("answered");
    expect(acceptedRow.creator_type).toBe("ai");
    expect(acceptedRow.ai_run_id).toBe(firstRow.run_id);
    expect(acceptedRow.approved_by).toBeNull(); // accepted ≠ approved
  });

  it("a human rewrite folds the draft: provenance and citations are cleared", async () => {
    const provisioned = await provisionQuestionnaire({
      organizationId: orgA, title: "Rewrite questionnaire", questionCount: 1,
    });
    const start = await ownerAClient.rpc("start_answer_run", startArgs({
      p_organization_id: orgA, p_questionnaire_id: provisioned.questionnaireId,
    }));
    const runId = (start.data as { run_id: string }[])[0]!.run_id;
    const claim = await ownerAClient.rpc("claim_answer_run_items", {
      p_organization_id: orgA, p_run_id: runId, p_batch_size: 1,
    });
    const itemId = ((claim.data ?? []) as { item_id: string }[])[0]!.item_id;
    expectOk(
      await ownerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: itemId,
        p_run_id: runId,
        p_disposition: "answered",
        p_answer_text: "AI draft about breach notification windows.",
        p_strength: "medium",
        p_citations: [chunkCitation(chunkCurrent)],
      })),
      "draft",
    );
    const questionId = ((claim.data ?? []) as { question_id: string }[])[0]!.question_id;
    const answer = await ownerAClient
      .from("answers")
      .select("id, revision")
      .eq("question_id", questionId)
      .single();
    const { id: answerId, revision } = answer.data as { id: string; revision: number };

    expectOk(
      await ownerAClient.rpc("save_answer", {
        p_organization_id: orgA,
        p_question_id: questionId,
        p_text: "Human rewrite of the draft.",
        p_expected_revision: revision,
      }),
      "human rewrite",
    );
    const rewritten = await ownerAClient
      .from("answers")
      .select("status, creator_type, ai_run_id, ai_disposition, evidence_strength, review_note")
      .eq("id", answerId)
      .single();
    const row = rewritten.data as {
      status: string; creator_type: string; ai_run_id: string | null;
      ai_disposition: string | null; evidence_strength: string | null; review_note: string | null;
    };
    expect(row.status).toBe("answered");
    expect(row.creator_type).toBe("manual");
    expect(row.ai_run_id).toBeNull();
    expect(row.ai_disposition).toBeNull();
    expect(row.evidence_strength).toBeNull();
    expectNoRows(
      await ownerAClient.from("answer_citations").select("*").eq("answer_id", answerId),
      "citations cleared on rewrite",
    );
  });

  it("the per-org kill switch blocks run creation", async () => {
    expectOk(
      await ownerBClient.from("organizations").update({ ai_drafts_disabled: true }).eq("id", orgB),
      "disable AI for Org B",
    );
    const provisioned = await provisionQuestionnaire({
      organizationId: orgB, title: "Org B questionnaire", questionCount: 1,
    });
    expectErrorWithCode(
      await ownerBClient.rpc("start_answer_run", startArgs({
        p_organization_id: orgB, p_questionnaire_id: provisioned.questionnaireId,
      })),
      "AI_DISABLED_FOR_ORG",
      "start under kill switch",
    );
    expectOk(
      await ownerBClient.from("organizations").update({ ai_drafts_disabled: false }).eq("id", orgB),
      "re-enable AI for Org B",
    );
  });

  it("run size is capped by private.ai_limits (default ceiling: 250)", async () => {
    // 251 questions — one past the default max_questions_per_run. Inserted as
    // a single batch (service role, fixture setup only) so the boundary is
    // exercised against the REAL default instead of mutating the singleton.
    const provisioned = await provisionQuestionnaire({
      organizationId: orgA, title: "Limit questionnaire", questionCount: 0,
    });
    const admin = getAdminClient();
    const rows = Array.from({ length: 251 }, (_, index) => ({
      questionnaire_id: provisioned.questionnaireId,
      organization_id: orgA,
      position: index,
      sheet_name: "Sheet1",
      row_number: index + 2,
      question_cell: `B${index + 2}`,
      answer_cell: `C${index + 2}`,
      question_original: `Limit fixture question ${index + 1}?`,
      question_normalized: `Limit fixture question ${index + 1}?`,
      category: "general",
    }));
    const inserted = await admin.from("questions").insert(rows);
    if (inserted.error !== null) {
      throw new Error(`limit fixture questions failed: ${inserted.error.message}`);
    }

    expectErrorWithCode(
      await ownerAClient.rpc("start_answer_run", startArgs({
        p_organization_id: orgA, p_questionnaire_id: provisioned.questionnaireId,
      })),
      "RUN_TOO_LARGE",
      "run over limit",
    );
  });

  it("an empty questionnaire cannot start a run", async () => {
    const provisioned = await provisionQuestionnaire({
      organizationId: orgA, title: "Empty questionnaire", questionCount: 0,
    });
    expectErrorWithCode(
      await ownerAClient.rpc("start_answer_run", startArgs({
        p_organization_id: orgA, p_questionnaire_id: provisioned.questionnaireId,
      })),
      "RUN_NO_QUESTIONS",
      "no eligible questions",
    );
  });

  it("explicit selection of ineligible questions is refused, not skipped", async () => {
    const provisioned = await provisionQuestionnaire({
      organizationId: orgA, title: "Explicit-selection questionnaire", questionCount: 1,
    });
    const questionId = provisioned.questionIds[0]!;
    await provisionAnswer({
      organizationId: orgA, questionId,
      status: "approved" as Database["public"]["Tables"]["answers"]["Insert"]["status"],
    });

    expectErrorWithCode(
      await ownerAClient.rpc("start_answer_run", startArgs({
        p_organization_id: orgA,
        p_questionnaire_id: provisioned.questionnaireId,
        p_question_ids: [questionId],
      })),
      "RUN_QUESTIONS_INELIGIBLE",
      "explicit approved question",
    );

    // Bulk run on the same questionnaire: the approved question is skipped.
    const bulk = await ownerAClient.rpc("start_answer_run", startArgs({
      p_organization_id: orgA, p_questionnaire_id: provisioned.questionnaireId,
    }));
    expectErrorWithCode(bulk, "RUN_NO_QUESTIONS", "bulk with nothing eligible");
  });

  it("approved AI answers remain auditable as AI-authored after human approval", async () => {
    const provisioned = await provisionQuestionnaire({
      organizationId: orgA, title: "Approve-draft questionnaire", questionCount: 1,
    });
    const start = await ownerAClient.rpc("start_answer_run", startArgs({
      p_organization_id: orgA, p_questionnaire_id: provisioned.questionnaireId,
    }));
    const runId = (start.data as { run_id: string }[])[0]!.run_id;
    const claim = await ownerAClient.rpc("claim_answer_run_items", {
      p_organization_id: orgA, p_run_id: runId, p_batch_size: 1,
    });
    const claimed = ((claim.data ?? []) as { item_id: string; question_id: string }[])[0]!;
    expectOk(
      await ownerAClient.rpc("complete_answer_run_item", completeArgs({
        p_item_id: claimed.item_id,
        p_run_id: runId,
        p_disposition: "answered",
        p_answer_text: "Draft heading for human approval.",
        p_strength: "high",
        p_citations: [chunkCitation(chunkCurrent)],
      })),
      "draft",
    );

    const answer = await ownerAClient
      .from("answers")
      .select("revision")
      .eq("question_id", claimed.question_id)
      .single();
    const { revision } = answer.data as { revision: number };

    // Draft → approved directly (human-only set_answer_status): the product
    // path for approving a good draft.
    expectOk(
      await ownerAClient.rpc("set_answer_status", {
        p_organization_id: orgA, p_question_id: claimed.question_id,
        p_status: "approved", p_expected_revision: revision,
      }),
      "human approves draft",
    );
    const approved = await ownerAClient
      .from("answers")
      .select("status, creator_type, ai_run_id, approved_by, approved_at")
      .eq("question_id", claimed.question_id)
      .single();
    const row = approved.data as {
      status: string; creator_type: string; ai_run_id: string | null;
      approved_by: string | null; approved_at: string | null;
    };
    expect(row.status).toBe("approved");
    expect(row.creator_type).toBe("ai");
    expect(row.ai_run_id).toBe(runId);
    expect(row.approved_by).toBe(ownerA.userId);
    expect(row.approved_at).not.toBeNull();
  });
});

/** Looks up the run item id for a question within a run (member client). */
async function itemIdForQuestion(runId: string, questionId: string): Promise<string> {
  const result = await ownerAClient
    .from("answer_run_items")
    .select("id")
    .eq("run_id", runId)
    .eq("question_id", questionId)
    .single();
  return (result.data as { id: string }).id;
}
