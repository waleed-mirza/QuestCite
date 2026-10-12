import { getAdminClient } from "./clients";

import type { Database } from "@/types/database.types";

/**
 * Fixture helpers for questionnaire tests (plan §W4).
 *
 * Provisions rows with the service-role client (fixture setup only —
 * assertions always run through anon/authenticated clients so RLS is what is
 * actually under test). Questionnaire fixture rows never touch storage; the
 * storage suite uploads real objects and tracks them for cleanup itself.
 */

const storagePaths: string[] = [];

export function trackQuestionnaireStoragePath(path: string): void {
  storagePaths.push(path);
}

/** Removes every questionnaire-bucket object created under test. */
export async function cleanupQuestionnaireStorage(): Promise<void> {
  if (storagePaths.length === 0) {
    return;
  }
  const admin = getAdminClient();
  await admin.storage.from("questionnaires").remove([...storagePaths]);
  storagePaths.splice(0);
}

export type ProvisionedQuestionnaire = {
  questionnaireId: string;
  fileId: string;
  storagePath: string;
  questionIds: string[];
};

/** Inserts a questionnaire + its original-file row + N questions (service role). */
export async function provisionQuestionnaire(input: {
  organizationId: string;
  title?: string;
  status?: Database["public"]["Tables"]["questionnaires"]["Insert"]["status"];
  questionCount?: number;
  sheetName?: string;
}): Promise<ProvisionedQuestionnaire> {
  const admin = getAdminClient();
  const questionnaireId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const storagePath = `${input.organizationId}/${questionnaireId}/${fileId}/fixture.xlsx`;

  const { error: qError } = await admin.from("questionnaires").insert({
    id: questionnaireId,
    organization_id: input.organizationId,
    title: input.title ?? "Fixture questionnaire",
    customer: "Fixture Customer",
    status: input.status ?? "active",
  });
  if (qError !== null) {
    throw new Error(`provisionQuestionnaire(questionnaire) failed: ${qError.message}`);
  }

  const { error: fError } = await admin.from("questionnaire_files").insert({
    id: fileId,
    questionnaire_id: questionnaireId,
    organization_id: input.organizationId,
    storage_path: storagePath,
    format: "xlsx",
    mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    byte_size: 5432,
    checksum_sha256: "c".repeat(64),
    parser_version: "exceljs@4.4.0",
  });
  if (fError !== null) {
    throw new Error(`provisionQuestionnaire(file) failed: ${fError.message}`);
  }

  const sheetName = input.sheetName ?? "Sheet1";
  const questionIds: string[] = [];
  for (let index = 0; index < (input.questionCount ?? 0); index += 1) {
    const questionId = crypto.randomUUID();
    const { error } = await admin.from("questions").insert({
      id: questionId,
      questionnaire_id: questionnaireId,
      organization_id: input.organizationId,
      position: index,
      sheet_name: sheetName,
      row_number: index + 2,
      question_cell: `B${index + 2}`,
      answer_cell: `C${index + 2}`,
      question_original: `Fixture question ${index + 1}?`,
      question_normalized: `Fixture question ${index + 1}?`,
      category: "general",
    });
    if (error !== null) {
      throw new Error(`provisionQuestionnaire(question ${index}) failed: ${error.message}`);
    }
    questionIds.push(questionId);
  }

  return { questionnaireId, fileId, storagePath, questionIds };
}

/** Inserts an answer row directly (service role) — bypasses the RPC state machine. */
export async function provisionAnswer(input: {
  organizationId: string;
  questionId: string;
  text?: string;
  status?: Database["public"]["Tables"]["answers"]["Insert"]["status"];
  createdBy?: string;
}): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("answers")
    .insert({
      organization_id: input.organizationId,
      question_id: input.questionId,
      current_text: input.text ?? "Fixture answer text.",
      status: input.status ?? "answered",
      creator_type: "manual",
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();
  if (error !== null || data === null) {
    throw new Error(`provisionAnswer failed: ${error?.message ?? "no id"}`);
  }
  return data.id;
}
