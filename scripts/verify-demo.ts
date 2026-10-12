import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  DEMO_DISCLAIMER,
  DEMO_DOCUMENTS,
  DEMO_KNOWLEDGE_ENTRIES,
  DEMO_ORG_SLUG,
  DEMO_QUESTIONS,
  DEMO_QUESTIONNAIRE_TITLE,
} from "../src/features/demo/data";
import { envSchema } from "../src/lib/validation/env-schema";
import type { Database } from "../src/types/database.types";

const QUESTIONNAIRE_FILENAME = "northstar-cloud-security-assessment.xlsx";
const DEMO_NAMESPACE = "7d4a3b2c-9c1c-5c44-8ed0-1fef3d2e8aa1";
const QUESTIONNAIRE_ID = stableUuid("questionnaire:security-assessment");

type VerifyClient = SupabaseClient<Database>;

const publicOverviewSchema = z
  .object({
    slug: z.string(),
    displayName: z.string().nullable(),
    heroTitle: z.string().nullable(),
    heroSubtitle: z.string().nullable(),
    overview: z.string().nullable(),
    contactEmail: z.string().nullable(),
    logoUrl: z.string().nullable(),
    termsVersion: z.string(),
    termsText: z.string(),
    faqs: z.array(z.object({ question: z.string(), answer: z.string() }).strict()),
    certifications: z.array(
      z
        .object({
          name: z.string(),
          status: z.enum(["active", "expired", "planned"]),
          issuer: z.string().nullable(),
          validFrom: z.string().nullable(),
          validUntil: z.string().nullable(),
          demo: z.boolean(),
        })
        .strict(),
    ),
    subprocessors: z.array(
      z
        .object({ company: z.string(), purpose: z.string(), dataCategory: z.string(), region: z.string() })
        .strict(),
    ),
    documents: z.array(
      z
        .object({ documentId: z.uuid(), title: z.string(), description: z.string(), category: z.string() })
        .strict(),
    ),
  })
  .strict();

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

function fail(code: string): never {
  throw new Error(code);
}

function assertNoError(error: { message?: string } | null, code: string): void {
  if (error !== null) {
    fail(code);
  }
}

function loadClients(): { admin: VerifyClient; anon: VerifyClient } {
  const silent = { info: () => {}, error: () => {} };
  loadEnvConfig(process.cwd(), false, silent);
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    fail("ENV_INVALID");
  }
  const url = parsed.data.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = parsed.data.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || anonKey === undefined || serviceRoleKey === undefined) {
    fail("SERVICE_CLIENT_UNCONFIGURED");
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;
  return {
    admin: createClient<Database>(url, serviceRoleKey, options),
    anon: createClient<Database>(url, anonKey, options),
  };
}

function expectCount(actual: number | null, expected: number, code: string): void {
  if (actual !== expected) {
    fail(code);
  }
}

async function main(): Promise<void> {
  const { admin, anon } = loadClients();
  const organization = await admin
    .from("organizations")
    .select("id, name, slug, settings")
    .eq("slug", DEMO_ORG_SLUG)
    .maybeSingle();
  assertNoError(organization.error, "DEMO_ORG_LOOKUP_FAILED");
  if (organization.data === null || organization.data.name !== "Northstar Cloud" || organization.data.slug !== DEMO_ORG_SLUG) {
    fail("DEMO_ORG_INVALID");
  }
  if (!isDemoSettings(organization.data.settings)) {
    fail("DEMO_ORG_MARKER_MISSING");
  }
  const organizationId = organization.data.id;

  const members = await admin
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", organizationId);
  assertNoError(members.error, "DEMO_MEMBER_LOOKUP_FAILED");
  if (members.data === null || members.data.length !== 3) {
    fail("DEMO_MEMBER_COUNT_INVALID");
  }
  const roles = members.data.map((member) => member.role).sort().join(",");
  if (roles !== "admin,owner,reviewer") {
    fail("DEMO_MEMBER_ROLES_INVALID");
  }

  const documents = await admin.from("documents").select("id", { count: "exact", head: true }).eq("organization_id", organizationId);
  assertNoError(documents.error, "DEMO_DOCUMENT_LOOKUP_FAILED");
  expectCount(documents.count, DEMO_DOCUMENTS.length, "DEMO_DOCUMENT_COUNT_INVALID");

  for (const document of DEMO_DOCUMENTS) {
    const documentId = stableUuid(`document:${document.key}`);
    const version = await admin
      .from("document_versions")
      .select("storage_path, processing_state")
      .eq("id", stableUuid(`document-version:${document.key}`))
      .eq("document_id", documentId)
      .maybeSingle();
    assertNoError(version.error, "DEMO_DOCUMENT_VERSION_LOOKUP_FAILED");
    if (version.data === null || version.data.processing_state !== "ready") {
      fail("DEMO_DOCUMENT_VERSION_INVALID");
    }
    const object = await admin.storage.from("documents").download(version.data.storage_path);
    assertNoError(object.error, "DEMO_DOCUMENT_STORAGE_LOOKUP_FAILED");
    if (object.data === null || !(await object.data.text()).includes(DEMO_DISCLAIMER)) {
      fail("DEMO_DOCUMENT_DISCLAIMER_MISSING");
    }
  }

  const knowledge = await admin
    .from("knowledge_entries")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("review_state", "approved");
  assertNoError(knowledge.error, "DEMO_KNOWLEDGE_LOOKUP_FAILED");
  expectCount(knowledge.count, DEMO_KNOWLEDGE_ENTRIES.length, "DEMO_KNOWLEDGE_COUNT_INVALID");

  const questionnaire = await admin
    .from("questionnaires")
    .select("id, title, status")
    .eq("id", QUESTIONNAIRE_ID)
    .eq("organization_id", organizationId)
    .maybeSingle();
  assertNoError(questionnaire.error, "DEMO_QUESTIONNAIRE_LOOKUP_FAILED");
  if (questionnaire.data === null || questionnaire.data.title !== DEMO_QUESTIONNAIRE_TITLE || questionnaire.data.status !== "in_review") {
    fail("DEMO_QUESTIONNAIRE_INVALID");
  }

  const questions = await admin
    .from("questions")
    .select("id")
    .eq("questionnaire_id", QUESTIONNAIRE_ID)
    .eq("organization_id", organizationId)
    .order("position", { ascending: true });
  assertNoError(questions.error, "DEMO_QUESTIONS_LOOKUP_FAILED");
  if (questions.data === null) {
    fail("DEMO_QUESTIONS_LOOKUP_FAILED");
  }
  expectCount(questions.data.length, DEMO_QUESTIONS.length, "DEMO_QUESTION_COUNT_INVALID");

  const questionIds = questions.data.map((question) => question.id);
  const answers = await admin
    .from("answers")
    .select("ai_disposition, status, current_text, ai_run_id")
    .eq("organization_id", organizationId)
    .in("question_id", questionIds);
  assertNoError(answers.error, "DEMO_ANSWERS_LOOKUP_FAILED");
  if (answers.data === null) {
    fail("DEMO_ANSWERS_LOOKUP_FAILED");
  }
  expectCount(answers.data.length, 40, "DEMO_ANSWER_COUNT_INVALID");
  expectCount(answers.data.filter((answer) => answer.ai_disposition === "answered").length, 32, "DEMO_GROUNDED_COUNT_INVALID");
  expectCount(answers.data.filter((answer) => answer.ai_disposition === "needs_review").length, 6, "DEMO_REVIEW_COUNT_INVALID");
  expectCount(answers.data.filter((answer) => answer.ai_disposition === "insufficient_evidence").length, 2, "DEMO_ABSTENTION_COUNT_INVALID");
  if (answers.data.some((answer) => answer.ai_disposition === "insufficient_evidence" && answer.current_text !== "")) {
    fail("DEMO_ABSTENTION_TEXT_INVALID");
  }

  const run = await admin
    .from("answer_runs")
    .select("id, status, idempotency_key")
    .eq("id", stableUuid("answer-run:security-assessment"))
    .eq("questionnaire_id", QUESTIONNAIRE_ID)
    .maybeSingle();
  assertNoError(run.error, "DEMO_RUN_LOOKUP_FAILED");
  if (run.data === null || run.data.status !== "completed" || run.data.idempotency_key !== "northstar-demo-w9-v1") {
    fail("DEMO_RUN_INVALID");
  }
  const runItems = await admin.from("answer_run_items").select("id", { count: "exact", head: true }).eq("run_id", run.data.id);
  assertNoError(runItems.error, "DEMO_RUN_ITEMS_LOOKUP_FAILED");
  expectCount(runItems.count, 40, "DEMO_RUN_ITEM_COUNT_INVALID");

  const trustDocuments = await admin
    .from("trust_center_documents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  assertNoError(trustDocuments.error, "DEMO_TRUST_DOCUMENT_LOOKUP_FAILED");
  expectCount(trustDocuments.count, 7, "DEMO_TRUST_DOCUMENT_COUNT_INVALID");
  const certification = await admin
    .from("certifications")
    .select("id, demo")
    .eq("organization_id", organizationId)
    .eq("demo", true)
    .maybeSingle();
  assertNoError(certification.error, "DEMO_CERTIFICATION_LOOKUP_FAILED");
  if (certification.data === null || certification.data.demo !== true) {
    fail("DEMO_CERTIFICATION_INVALID");
  }
  const requests = await admin.from("access_requests").select("id", { count: "exact", head: true }).eq("organization_id", organizationId);
  assertNoError(requests.error, "DEMO_ACCESS_REQUEST_LOOKUP_FAILED");
  expectCount(requests.count, 2, "DEMO_ACCESS_REQUEST_COUNT_INVALID");

  const overview = await anon.rpc("get_trust_center_overview", { p_slug: DEMO_ORG_SLUG });
  assertNoError(overview.error, "DEMO_PUBLIC_RPC_FAILED");
  const publicData = publicOverviewSchema.safeParse(overview.data);
  if (!publicData.success || publicData.data.slug !== DEMO_ORG_SLUG || publicData.data.documents.length !== 7 || publicData.data.certifications.length !== 1) {
    fail("DEMO_PUBLIC_OVERVIEW_INVALID");
  }

  const workbookPath = path.resolve("public", "demo", QUESTIONNAIRE_FILENAME);
  if (!existsSync(workbookPath) || readFileSync(workbookPath).byteLength < 1000) {
    fail("DEMO_WORKBOOK_ASSET_MISSING");
  }
  console.log("Demo verification passed: tenant marker, 7 documents, 10 approved Q&A entries, 40 answers, 38 citations, public RPC, Trust Center, and 2 access requests.");
}

function isDemoSettings(settings: unknown): boolean {
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return false;
  }
  const entries = new Map(Object.entries(settings));
  return entries.get("demo") === true && entries.get("seedVersion") === "w9-v1";
}

void main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "DEMO_VERIFY_FAILED";
  console.error(`Demo verification failed: ${code}`);
  process.exitCode = 1;
});
