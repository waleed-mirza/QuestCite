"use server";

import { revalidatePath } from "next/cache";

import type { Database } from "@/types/database.types";

import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveKnowledgeEntrySchema } from "@/lib/validation/document";
import { requireOrgRole } from "@/server/authorization/org";

/**
 * Knowledge entry writes (plan §W3). Both creates and edits go through the
 * save_knowledge_entry RPC so the entry row and its immutable version row
 * commit atomically (migration 0003); the lifecycle audit trail is written by
 * the entry trigger inside the same transaction.
 */

export type EntryActionState =
  | { status: "idle" }
  | { status: "success"; entryId: string; message: string }
  | { status: "error"; message: string };

export async function saveKnowledgeEntryAction(
  orgSlug: string,
  _prev: EntryActionState,
  formData: FormData,
): Promise<EntryActionState> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);

  const stringField = (name: string): string | undefined => {
    const value = formData.get(name);
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
  };
  const parsed = saveKnowledgeEntrySchema.safeParse({
    question: stringField("question"),
    answer: stringField("answer"),
    category: stringField("category"),
    reviewState: stringField("reviewState"),
    reviewBy: stringField("reviewBy") ?? null,
    entryId: stringField("entryId") ?? null,
  });
  const tags = (stringField("tagsText") ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag !== "");
  if (!parsed.success || tags.length > 20) {
    return { status: "error", message: "A question and an answer are required; check lengths and the review state." };
  }

  const supabase = await createSupabaseServerClient();
  // supabase-js generated RPC arg types cannot express NULLABLE Postgres
  // parameters (`date`/`uuid` typed bare `string`) — same documented
  // assertion as the upload route; the SQL accepts NULL (migration 0003).
  const entryArgs = {
    p_organization_id: ctx.organization.id,
    p_question: parsed.data.question,
    p_answer: parsed.data.answer,
    p_category: parsed.data.category,
    p_tags: tags,
    p_review_state: parsed.data.reviewState,
    p_review_by: parsed.data.reviewBy,
    p_entry_id: parsed.data.entryId,
  } as Database["public"]["Functions"]["save_knowledge_entry"]["Args"];

  const { data: savedId, error } = await supabase.rpc("save_knowledge_entry", entryArgs);

  if (error !== null || savedId === null || typeof savedId !== "string") {
    logger.warn("entry save failed", { code: error?.message.slice(0, 40) ?? "no-id" });
    return { status: "error", message: "The entry could not be saved." };
  }

  revalidatePath(`/app/${orgSlug}/knowledge`);
  return {
    status: "success",
    entryId: savedId,
    message: parsed.data.entryId === null ? "Entry created." : "Entry saved as a new version.",
  };
}

export async function deleteKnowledgeEntryAction(orgSlug: string, formData: FormData): Promise<void> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const entryId = formData.get("entryId");
  if (typeof entryId !== "string" || entryId === "") {
    return;
  }
  const supabase = await createSupabaseServerClient();
  await supabase.from("knowledge_entries").delete().eq("id", entryId).eq("organization_id", ctx.organization.id);
  revalidatePath(`/app/${orgSlug}/knowledge`);
}
