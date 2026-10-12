import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  DEMO_DOCUMENTS,
  DEMO_KNOWLEDGE_ENTRIES,
  DEMO_ORG_NAME,
  DEMO_ORG_SLUG,
  DEMO_QUESTIONS,
  DEMO_QUESTIONNAIRE_SHEET,
  DEMO_QUESTIONNAIRE_TITLE,
  type DemoDocumentKey,
} from "../src/features/demo/data";
import { envSchema } from "../src/lib/validation/env-schema";
import { assertProtectedOperationAllowed } from "../src/lib/operations/production-guard";
import type { Database } from "../src/types/database.types";
import { createDemoWorkbook } from "./demo-workbook";

const SEED_VERSION = "w9-v1";
const DEMO_NAMESPACE = "7d4a3b2c-9c1c-5c44-8ed0-1fef3d2e8aa1";
const QUESTIONNAIRE_FILENAME = "northstar-cloud-security-assessment.xlsx";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DEMO_TERMS_VERSION = "demo-2026-09";
const DEMO_TERMS =
  "Sample access terms: Northstar Cloud is fictional demo content. SAMPLE DATA — NOT LEGAL OR COMPLIANCE ADVICE.";

type SeedClient = SupabaseClient<Database>;
type SeedUser = { id: string; email: string };
type SeedUsers = { owner: SeedUser; admin: SeedUser; reviewer: SeedUser };

const USER_SPECS = [
  { key: "owner", email: "owner@northstar-cloud.example", name: "Maya Chen", role: "owner" as const },
  { key: "admin", email: "admin@northstar-cloud.example", name: "Jon Bell", role: "admin" as const },
  { key: "reviewer", email: "reviewer@northstar-cloud.example", name: "Sam Rivera", role: "reviewer" as const },
] as const;

function stableUuid(name: string): string {
  const digest = createHash("sha1").update(`${DEMO_NAMESPACE}:${name}`).digest();
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  return [
    digest.subarray(0, 4).toString("hex"),
    digest.subarray(4, 6).toString("hex"),
    digest.subarray(6, 8).toString("hex"),
    digest.subarray(8, 10).toString("hex"),
    digest.subarray(10, 16).toString("hex"),
  ].join("-");
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fail(code: string): never {
  throw new Error(code);
}

function assertNoError(error: { message?: string } | null, code: string): void {
  if (error !== null) {
    fail(code);
  }
}

function loadSeedClient(): SeedClient {
  const silent = { info: () => {}, error: () => {} };
  loadEnvConfig(process.cwd(), false, silent);
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    fail("ENV_INVALID");
  }
  try {
    assertProtectedOperationAllowed("demo-seed");
  } catch (error) {
    fail(error instanceof Error ? error.message : "DEMO_SEED_BLOCKED_IN_PRODUCTION");
  }
  const url = parsed.data.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = parsed.data.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || serviceRoleKey === undefined) {
    fail("SERVICE_CLIENT_UNCONFIGURED");
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isDemoSettings(settings: unknown): boolean {
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return false;
  }
  const entries = new Map(Object.entries(settings));
  return entries.get("demo") === true && entries.get("seedVersion") === SEED_VERSION;
}

async function ensureAuthUser(client: SeedClient, spec: (typeof USER_SPECS)[number]): Promise<SeedUser> {
  let page = 1;
  while (page <= 100) {
    const listed = await client.auth.admin.listUsers({ page, perPage: 1000 });
    assertNoError(listed.error, "DEMO_AUTH_LIST_FAILED");
    const found = listed.data.users.find((user) => user.email?.toLowerCase() === spec.email);
    if (found !== undefined) {
      return { id: found.id, email: spec.email };
    }
    if (listed.data.users.length < 1000) {
      break;
    }
    page += 1;
  }

  const created = await client.auth.admin.createUser({
    email: spec.email,
    password: randomBytes(32).toString("base64url"),
    email_confirm: true,
    user_metadata: { full_name: spec.name },
  });
  assertNoError(created.error, "DEMO_AUTH_CREATE_FAILED");
  if (created.data.user === null) {
    fail("DEMO_AUTH_CREATE_FAILED");
  }
  return { id: created.data.user.id, email: spec.email };
}

async function ensureUsers(client: SeedClient): Promise<SeedUsers> {
  const users = await Promise.all(USER_SPECS.map((spec) => ensureAuthUser(client, spec)));
  const owner = users[0];
  const admin = users[1];
  const reviewer = users[2];
  if (owner === undefined || admin === undefined || reviewer === undefined) {
    fail("DEMO_AUTH_CREATE_FAILED");
  }
  return { owner, admin, reviewer };
}

async function ensureOrganization(client: SeedClient): Promise<string> {
  const existing = await client
    .from("organizations")
    .select("id, name, slug, settings")
    .eq("slug", DEMO_ORG_SLUG)
    .maybeSingle();
  assertNoError(existing.error, "DEMO_ORG_LOOKUP_FAILED");

  if (existing.data !== null && !isDemoSettings(existing.data.settings)) {
    fail("DEMO_SLUG_CONFLICT");
  }
  if (existing.data !== null) {
    const updated = await client
      .from("organizations")
      .update({ name: DEMO_ORG_NAME, status: "active", settings: { demo: true, seedVersion: SEED_VERSION } })
      .eq("id", existing.data.id);
    assertNoError(updated.error, "DEMO_ORG_UPDATE_FAILED");
    return existing.data.id;
  }

  const created = await client
    .from("organizations")
    .insert({
      id: stableUuid("organization"),
      name: DEMO_ORG_NAME,
      slug: DEMO_ORG_SLUG,
      settings: { demo: true, seedVersion: SEED_VERSION },
    })
    .select("id")
    .single();
  if (created.error !== null) {
    const raced = await client
      .from("organizations")
      .select("id, settings")
      .eq("slug", DEMO_ORG_SLUG)
      .maybeSingle();
    assertNoError(raced.error, "DEMO_ORG_LOOKUP_FAILED");
    if (raced.data === null || !isDemoSettings(raced.data.settings)) {
      fail("DEMO_SLUG_CONFLICT");
    }
    return raced.data.id;
  }
  if (created.data === null) {
    fail("DEMO_ORG_CREATE_FAILED");
  }
  return created.data.id;
}

async function seedMemberships(client: SeedClient, organizationId: string, users: SeedUsers): Promise<void> {
  const profiles = [
    { id: users.owner.id, email: users.owner.email, full_name: "Maya Chen" },
    { id: users.admin.id, email: users.admin.email, full_name: "Jon Bell" },
    { id: users.reviewer.id, email: users.reviewer.email, full_name: "Sam Rivera" },
  ];
  const profileResult = await client.from("profiles").upsert(profiles, { onConflict: "id" });
  assertNoError(profileResult.error, "DEMO_PROFILE_SEED_FAILED");

  const membershipResult = await client.from("organization_members").upsert(
    profiles.map((profile, index) => ({
      organization_id: organizationId,
      user_id: profile.id,
      role: USER_SPECS[index]?.role ?? "reviewer",
    })),
    { onConflict: "organization_id,user_id" },
  );
  assertNoError(membershipResult.error, "DEMO_MEMBERSHIP_SEED_FAILED");
}

type SeededDocument = { id: string; versionId: string; chunkId: string; contents: Buffer };

async function seedDocuments(client: SeedClient, organizationId: string, ownerId: string): Promise<Map<DemoDocumentKey, SeededDocument>> {
  const documents = new Map<DemoDocumentKey, SeededDocument>();
  for (const document of DEMO_DOCUMENTS) {
    const contents = readFileSync(path.resolve("demo", "documents", document.filename));
    const documentId = stableUuid(`document:${document.key}`);
    const versionId = stableUuid(`document-version:${document.key}`);
    const chunkId = stableUuid(`document-chunk:${document.key}`);
    const storagePath = `${organizationId}/${documentId}/${versionId}/${document.filename}`;
    const checksum = sha256(contents);

    const uploaded = await client.storage.from("documents").upload(storagePath, contents, {
      contentType: "text/markdown",
      upsert: true,
    });
    assertNoError(uploaded.error, "DEMO_DOCUMENT_UPLOAD_FAILED");

    const documentResult = await client.from("documents").upsert(
      {
        id: documentId,
        organization_id: organizationId,
        title: document.title,
        category: document.category,
        tags: ["demo", "northstar-cloud"],
        owner_id: ownerId,
        review_by: "2027-09-04",
        state: "active",
      },
      { onConflict: "id" },
    );
    assertNoError(documentResult.error, "DEMO_DOCUMENT_SEED_FAILED");

    const versionResult = await client.from("document_versions").upsert(
      {
        id: versionId,
        document_id: documentId,
        organization_id: organizationId,
        version_number: 1,
        storage_path: storagePath,
        mime_type: "text/markdown",
        byte_size: contents.byteLength,
        checksum_sha256: checksum,
        parser_version: "demo@1",
        processing_state: "ready",
        processing_error_code: null,
        processing_attempts: 0,
        page_count: 1,
        char_count: contents.byteLength,
      },
      { onConflict: "id" },
    );
    assertNoError(versionResult.error, "DEMO_DOCUMENT_VERSION_SEED_FAILED");

    const chunkResult = await client.from("document_chunks").upsert(
      {
        id: chunkId,
        organization_id: organizationId,
        document_id: documentId,
        version_id: versionId,
        sequence: 0,
        section: document.title,
        content: contents.toString("utf8"),
        token_count: Math.max(1, Math.ceil(contents.byteLength / 4)),
        checksum_sha256: checksum,
        embedding: null,
      },
      { onConflict: "id" },
    );
    assertNoError(chunkResult.error, "DEMO_DOCUMENT_CHUNK_SEED_FAILED");
    documents.set(document.key, { id: documentId, versionId, chunkId, contents });
  }
  return documents;
}

async function seedKnowledge(client: SeedClient, organizationId: string, ownerId: string): Promise<Map<string, string>> {
  const entryIds = new Map<string, string>();
  for (const entry of DEMO_KNOWLEDGE_ENTRIES) {
    const entryId = stableUuid(`knowledge-entry:${entry.key}`);
    const versionId = stableUuid(`knowledge-entry-version:${entry.key}`);
    const entryResult = await client.from("knowledge_entries").upsert(
      {
        id: entryId,
        organization_id: organizationId,
        question: entry.question,
        answer: entry.answer,
        category: entry.category,
        tags: ["demo", entry.category],
        owner_id: ownerId,
        review_state: "approved",
        review_by: "2027-09-04",
      },
      { onConflict: "id" },
    );
    assertNoError(entryResult.error, "DEMO_KNOWLEDGE_SEED_FAILED");

    const versionResult = await client.from("knowledge_entry_versions").upsert(
      {
        id: versionId,
        organization_id: organizationId,
        entry_id: entryId,
        version_number: 1,
        question: entry.question,
        answer: entry.answer,
        category: entry.category,
        tags: ["demo", entry.category],
        review_state: "approved",
        edited_by: ownerId,
      },
      { onConflict: "id" },
    );
    assertNoError(versionResult.error, "DEMO_KNOWLEDGE_VERSION_SEED_FAILED");
    entryIds.set(entry.key, entryId);
  }
  return entryIds;
}

async function seedQuestionnaire(
  client: SeedClient,
  organizationId: string,
  users: SeedUsers,
  documents: Map<DemoDocumentKey, SeededDocument>,
): Promise<{ questionnaireId: string; questionIds: Map<string, string>; runId: string }> {
  const questionnaireId = stableUuid("questionnaire:security-assessment");
  const fileId = stableUuid("questionnaire-file:security-assessment");
  const runId = stableUuid("answer-run:security-assessment");
  await resetSeedQuestionnaire(client, organizationId, questionnaireId);
  const original = await createDemoWorkbook("original");
  const checksum = sha256(original);
  const storagePath = `${organizationId}/${questionnaireId}/${fileId}/${QUESTIONNAIRE_FILENAME}`;

  const uploaded = await client.storage.from("questionnaires").upload(storagePath, original, {
    contentType: XLSX_MIME,
    upsert: true,
  });
  assertNoError(uploaded.error, "DEMO_QUESTIONNAIRE_UPLOAD_FAILED");

  const questionnaireResult = await client.from("questionnaires").upsert(
    {
      id: questionnaireId,
      organization_id: organizationId,
      title: DEMO_QUESTIONNAIRE_TITLE,
      customer: DEMO_ORG_NAME,
      status: "in_review",
      due_date: "2026-10-01",
      assigned_reviewer: users.reviewer.id,
      created_by: users.owner.id,
    },
    { onConflict: "id" },
  );
  assertNoError(questionnaireResult.error, "DEMO_QUESTIONNAIRE_SEED_FAILED");

  const fileResult = await client.from("questionnaire_files").upsert(
    {
      id: fileId,
      questionnaire_id: questionnaireId,
      organization_id: organizationId,
      storage_path: storagePath,
      format: "xlsx",
      mime_type: XLSX_MIME,
      byte_size: original.byteLength,
      checksum_sha256: checksum,
      parser_version: "demo@1",
      metadata: {},
      exported_storage_path: null,
      exported_checksum_sha256: null,
      exported_at: null,
    },
    { onConflict: "id" },
  );
  assertNoError(fileResult.error, "DEMO_QUESTIONNAIRE_FILE_SEED_FAILED");

  const questionIds = new Map<string, string>();
  const questionRows = DEMO_QUESTIONS.map((question, index) => {
    const questionId = stableUuid(`question:${question.key}`);
    questionIds.set(question.key, questionId);
    const rowNumber = index + 2;
    return {
      id: questionId,
      questionnaire_id: questionnaireId,
      organization_id: organizationId,
      position: index,
      sheet_name: DEMO_QUESTIONNAIRE_SHEET,
      row_number: rowNumber,
      question_cell: `A${rowNumber}`,
      answer_cell: `B${rowNumber}`,
      notes_cell: `C${rowNumber}`,
      question_original: question.question,
      question_normalized: question.question.trim(),
      category: question.category,
      status: question.status,
      blank_by_choice: false,
      assignee_id: users.reviewer.id,
    };
  });
  const questionsResult = await client.from("questions").upsert(questionRows, { onConflict: "id" });
  assertNoError(questionsResult.error, "DEMO_QUESTIONS_SEED_FAILED");

  const runResult = await client.from("answer_runs").upsert(
    {
      id: runId,
      organization_id: organizationId,
      questionnaire_id: questionnaireId,
      created_by: users.owner.id,
      model: "demo-replay",
      prompt_version: SEED_VERSION,
      status: "completed",
      idempotency_key: "northstar-demo-w9-v1",
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_micro_usd: 0,
      error_code: null,
      started_at: "2026-09-04T00:00:00.000Z",
      completed_at: "2026-09-04T00:00:04.000Z",
    },
    { onConflict: "id" },
  );
  assertNoError(runResult.error, "DEMO_ANSWER_RUN_SEED_FAILED");

  const answerRows = DEMO_QUESTIONS.map((question) => {
    const questionId = questionIds.get(question.key);
    if (questionId === undefined) {
      fail("DEMO_QUESTIONS_SEED_FAILED");
    }
    return {
      id: stableUuid(`answer:${question.key}`),
      question_id: questionId,
      organization_id: organizationId,
      current_text: question.answer,
      status: question.status,
      creator_type: "ai" as const,
      created_by: users.owner.id,
      approved_by: null,
      approved_at: null,
      revision: 1,
      ai_run_id: runId,
      ai_disposition: question.disposition,
      evidence_strength: question.evidenceStrength,
      review_note: question.reviewNote,
    };
  });
  const answersResult = await client.from("answers").upsert(answerRows, { onConflict: "id" });
  assertNoError(answersResult.error, "DEMO_ANSWERS_SEED_FAILED");

  const runItemRows = DEMO_QUESTIONS.map((question) => {
    const questionId = questionIds.get(question.key);
    if (questionId === undefined) {
      fail("DEMO_QUESTIONS_SEED_FAILED");
    }
    return {
      id: stableUuid(`answer-run-item:${question.key}`),
      run_id: runId,
      organization_id: organizationId,
      question_id: questionId,
      status: "completed" as const,
      attempts: 1,
      error_code: null,
      disposition: question.disposition,
      started_at: "2026-09-04T00:00:01.000Z",
      completed_at: "2026-09-04T00:00:04.000Z",
    };
  });
  const runItemsResult = await client.from("answer_run_items").upsert(runItemRows, { onConflict: "id" });
  assertNoError(runItemsResult.error, "DEMO_ANSWER_RUN_ITEMS_SEED_FAILED");

  const answerIds = DEMO_QUESTIONS.map((question) => stableUuid(`answer:${question.key}`));
  const oldCitations = await client
    .from("answer_citations")
    .delete()
    .eq("organization_id", organizationId)
    .in("answer_id", answerIds);
  assertNoError(oldCitations.error, "DEMO_CITATION_RESET_FAILED");

  const citationRows = DEMO_QUESTIONS.flatMap((question) => {
    if (question.sourceKey === null) {
      return [];
    }
    const document = documents.get(question.sourceKey);
    if (document === undefined) {
      fail("DEMO_CITATION_SEED_FAILED");
    }
    return [
      {
        id: stableUuid(`answer-citation:${question.key}`),
        answer_id: stableUuid(`answer:${question.key}`),
        organization_id: organizationId,
        source_type: "document_chunk",
        source_id: document.chunkId,
        excerpt_sha256: sha256(document.contents),
        retrieval_score: question.disposition === "answered" ? 0.94 : 0.68,
        position: 0,
      },
    ];
  });
  const citationsResult = await client.from("answer_citations").upsert(citationRows, { onConflict: "id" });
  assertNoError(citationsResult.error, "DEMO_CITATION_SEED_FAILED");
  if (citationRows.length !== 38 || DEMO_QUESTIONS.length !== 40) {
    fail("DEMO_QUESTIONNAIRE_SHAPE_INVALID");
  }
  return { questionnaireId, questionIds, runId };
}

async function resetSeedQuestionnaire(client: SeedClient, organizationId: string, questionnaireId: string): Promise<void> {
  const existing = await client
    .from("questionnaires")
    .select("organization_id")
    .eq("id", questionnaireId)
    .maybeSingle();
  assertNoError(existing.error, "DEMO_QUESTIONNAIRE_LOOKUP_FAILED");
  if (existing.data !== null && existing.data.organization_id !== organizationId) {
    fail("DEMO_QUESTIONNAIRE_CONFLICT");
  }

  const file = await client
    .from("questionnaire_files")
    .select("storage_path")
    .eq("questionnaire_id", questionnaireId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  assertNoError(file.error, "DEMO_QUESTIONNAIRE_FILE_LOOKUP_FAILED");
  if (file.data !== null) {
    const removed = await client.storage.from("questionnaires").remove([file.data.storage_path]);
    assertNoError(removed.error, "DEMO_QUESTIONNAIRE_STORAGE_RESET_FAILED");
  }

  if (existing.data !== null) {
    const deleted = await client
      .from("questionnaires")
      .delete()
      .eq("id", questionnaireId)
      .eq("organization_id", organizationId);
    assertNoError(deleted.error, "DEMO_QUESTIONNAIRE_RESET_FAILED");
  }
}

async function seedTrustCenter(
  client: SeedClient,
  organizationId: string,
  ownerId: string,
  documents: Map<DemoDocumentKey, SeededDocument>,
): Promise<{ documentIds: string[]; approvedRequestId: string }> {
  const trustCenterResult = await client.from("trust_centers").upsert(
    {
      organization_id: organizationId,
      slug: DEMO_ORG_SLUG,
      status: "published",
      display_name: DEMO_ORG_NAME,
      hero_title: "Security & Trust Center",
      hero_subtitle: "A fictional provider profile for the QuestCite product tour.",
      overview:
        "Northstar Cloud is a fictional tenant used to demonstrate evidence-grounded questionnaires, review gates, and buyer-facing trust content.",
      contact_email: "security@northstar-cloud.example",
      logo_url: null,
      terms_version: DEMO_TERMS_VERSION,
      terms_text: DEMO_TERMS,
      require_email_verification: false,
      settings: { demo: true, seedVersion: SEED_VERSION },
    },
    { onConflict: "organization_id" },
  );
  assertNoError(trustCenterResult.error, "DEMO_TRUST_CENTER_SEED_FAILED");

  const faqRows = [
    {
      id: stableUuid("trust-faq:security-program"),
      organization_id: organizationId,
      question: "Is Northstar Cloud real production data?",
      answer: "No. This is fictional sample data for a product tour.",
      visible: true,
      position: 0,
    },
    {
      id: stableUuid("trust-faq:access"),
      organization_id: organizationId,
      question: "Can I request the sample policies?",
      answer: "Yes. The request flow is represented with safe fictional records and private storage objects.",
      visible: true,
      position: 1,
    },
    {
      id: stableUuid("trust-faq:ai"),
      organization_id: organizationId,
      question: "Does the public demo call a live AI provider?",
      answer: "No. Generate answers replays stored results and provider operations are disabled.",
      visible: true,
      position: 2,
    },
  ];
  const faqResult = await client.from("trust_center_faqs").upsert(faqRows, { onConflict: "id" });
  assertNoError(faqResult.error, "DEMO_TRUST_FAQ_SEED_FAILED");

  const certificationResult = await client.from("certifications").upsert(
    {
      id: stableUuid("certification:demo-assurance"),
      organization_id: organizationId,
      name: "Security controls walkthrough",
      status: "active",
      issuer: "Fictional QuestCite Demo Program",
      valid_from: "2026-01-01",
      valid_until: "2026-12-31",
      demo: true,
      publicly_visible: true,
      position: 0,
    },
    { onConflict: "id" },
  );
  assertNoError(certificationResult.error, "DEMO_CERTIFICATION_SEED_FAILED");

  const subprocessorRows = [
    { company: "Northstar Compute", purpose: "Application hosting", dataCategory: "Workspace metadata", region: "Fictional US region" },
    { company: "Northstar Storage", purpose: "Encrypted object storage", dataCategory: "Uploaded files", region: "Fictional US region" },
    { company: "Northstar Observability", purpose: "Operational telemetry", dataCategory: "Safe service metadata", region: "Fictional EU region" },
  ].map(({ company, purpose, dataCategory, region }, position) => ({
    id: stableUuid(`subprocessor:${position}`),
    organization_id: organizationId,
    company,
    purpose,
    data_category: dataCategory,
    region,
    publicly_visible: true,
    position,
  }));
  const subprocessorResult = await client.from("subprocessors").upsert(subprocessorRows, { onConflict: "id" });
  assertNoError(subprocessorResult.error, "DEMO_SUBPROCESSOR_SEED_FAILED");

  const documentRows = DEMO_DOCUMENTS.map((document, position) => {
    const seeded = documents.get(document.key);
    if (seeded === undefined) {
      fail("DEMO_TRUST_DOCUMENT_SEED_FAILED");
    }
    return {
      id: stableUuid(`trust-document:${document.key}`),
      organization_id: organizationId,
      document_id: seeded.id,
      description: `${document.description} Sample data only.`,
      publicly_requestable: true,
      position,
    };
  });
  const documentResult = await client.from("trust_center_documents").upsert(documentRows, { onConflict: "id" });
  assertNoError(documentResult.error, "DEMO_TRUST_DOCUMENT_SEED_FAILED");

  const documentIds = documentRows.map((row) => row.document_id);
  const pendingRequestId = stableUuid("access-request:pending");
  const approvedRequestId = stableUuid("access-request:approved");
  const requestedAt = "2026-09-04T00:00:00.000Z";
  const expiresAt = "2026-10-04T00:00:00.000Z";
  const approvedTokenHash = sha256("northstar-cloud-demo-approved-token");
  const accessRequestResult = await client.from("access_requests").upsert(
    [
      {
        id: pendingRequestId,
        organization_id: organizationId,
        prospect_name: "Avery Morgan",
        prospect_company: "Example Buyer",
        prospect_email: "avery@example.invalid",
        state: "pending_review",
        requested_document_ids: documentIds.slice(0, 2),
        prospect_token_hash: null,
        request_expires_at: expiresAt,
        resolved_at: null,
        resolved_by: null,
        ip_hash: null,
        ua_summary: "demo-browser",
        created_at: requestedAt,
        updated_at: requestedAt,
      },
      {
        id: approvedRequestId,
        organization_id: organizationId,
        prospect_name: "Jordan Lee",
        prospect_company: "Example Security Team",
        prospect_email: "jordan@example.invalid",
        state: "approved",
        requested_document_ids: documentIds,
        prospect_token_hash: approvedTokenHash,
        request_expires_at: expiresAt,
        resolved_at: requestedAt,
        resolved_by: ownerId,
        ip_hash: null,
        ua_summary: "demo-browser",
        created_at: requestedAt,
        updated_at: requestedAt,
      },
    ],
    { onConflict: "id" },
  );
  assertNoError(accessRequestResult.error, "DEMO_ACCESS_REQUEST_SEED_FAILED");

  const grantRows = documentIds.map((documentId, position) => ({
    id: stableUuid(`access-grant:approved:${position}`),
    organization_id: organizationId,
    access_request_id: approvedRequestId,
    document_id: documentId,
    state: "active" as const,
    expires_at: expiresAt,
    granted_by: ownerId,
  }));
  const grantResult = await client.from("document_access_grants").upsert(grantRows, { onConflict: "id" });
  assertNoError(grantResult.error, "DEMO_ACCESS_GRANT_SEED_FAILED");

  const ndaResult = await client.from("nda_acceptances").upsert(
    {
      id: stableUuid("nda-acceptance:approved"),
      organization_id: organizationId,
      access_request_id: approvedRequestId,
      terms_version: DEMO_TERMS_VERSION,
      terms_hash: sha256(DEMO_TERMS),
      accepted_at: requestedAt,
      ip_hash: null,
    },
    { onConflict: "id" },
  );
  assertNoError(ndaResult.error, "DEMO_NDA_SEED_FAILED");

  const auditRows = [
    {
      id: stableUuid("audit:demo-seeded"),
      organization_id: organizationId,
      actor_id: ownerId,
      action: "demo.seeded",
      entity_type: "organization",
      entity_id: organizationId,
      metadata: { seed_version: SEED_VERSION, document_count: 7, question_count: 40 },
      created_at: requestedAt,
    },
    {
      id: stableUuid("audit:request-pending"),
      organization_id: organizationId,
      actor_id: null,
      action: "trust_access.requested",
      entity_type: "access_request",
      entity_id: pendingRequestId,
      metadata: { document_count: 2, demo: true },
      created_at: requestedAt,
    },
    {
      id: stableUuid("audit:request-approved"),
      organization_id: organizationId,
      actor_id: ownerId,
      action: "trust_access.approved",
      entity_type: "access_request",
      entity_id: approvedRequestId,
      metadata: { document_count: documentIds.length, grant_days: 30, demo: true },
      created_at: requestedAt,
    },
  ];
  const auditResult = await client.from("audit_events").upsert(auditRows, { onConflict: "id" });
  assertNoError(auditResult.error, "DEMO_AUDIT_SEED_FAILED");

  return { documentIds, approvedRequestId };
}

async function main(): Promise<void> {
  const client = loadSeedClient();
  const users = await ensureUsers(client);
  const organizationId = await ensureOrganization(client);
  await seedMemberships(client, organizationId, users);
  const documents = await seedDocuments(client, organizationId, users.owner.id);
  await seedKnowledge(client, organizationId, users.owner.id);
  await seedQuestionnaire(client, organizationId, users, documents);
  await seedTrustCenter(client, organizationId, users.owner.id, documents);
  console.log("Demo seed complete: 7 documents, 10 approved Q&A entries, 40 questions, 32 grounded drafts, 6 review flags, 2 abstentions, 3 members, 2 access requests.");
}

void main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "DEMO_SEED_FAILED";
  console.error(`Demo seed failed: ${code}`);
  process.exitCode = 1;
});
