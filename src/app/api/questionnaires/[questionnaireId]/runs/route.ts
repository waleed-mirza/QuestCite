import { NextResponse } from "next/server";

import type { Database } from "@/types/database.types";

import { PROMPT_VERSION } from "@/server/services/drafting";
import { getAnswerAvailability } from "@/lib/ai/answer-provider";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { answerRunStartRequestSchema } from "@/lib/validation/answer-runs";
import { ForbiddenError, NotFoundError, UnauthorizedError, isNotFoundError } from "@/server/errors";
import { requireOrgRole } from "@/server/authorization/org";
import { answerRunErrorResponse, safeAnswerRunCode } from "@/server/services/answer-run-http";
import { safeAnswerRunRpcCode } from "@/server/services/answer-run-gateway";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ questionnaireId: string }> },
): Promise<NextResponse> {
  let orgSlug = "";
  try {
    const { questionnaireId } = await params;
    if (!isUuid(questionnaireId)) {
      return answerRunErrorResponse("QUESTIONNAIRE_INPUT_INVALID");
    }

    const parsed = answerRunStartRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return answerRunErrorResponse("QUESTIONNAIRE_INPUT_INVALID");
    }
    orgSlug = parsed.data.orgSlug;

    const ctx = await requireOrgRole(["owner", "admin", "reviewer"], orgSlug);
    const availability = getAnswerAvailability();
    if (availability === "disabled") {
      return answerRunErrorResponse("AI_DISABLED");
    }
    if (availability === "not_configured") {
      return answerRunErrorResponse("AI_NOT_CONFIGURED");
    }

    const env = getServerEnv();
    const supabase = await createSupabaseServerClient();
    const args: Database["public"]["Functions"]["start_answer_run"]["Args"] = {
      p_organization_id: ctx.organization.id,
      p_questionnaire_id: questionnaireId,
      p_model: env.OPENAI_ANSWER_MODEL,
      p_prompt_version: PROMPT_VERSION,
      p_idempotency_key: parsed.data.idempotencyKey,
      ...(parsed.data.questionIds === undefined ? {} : { p_question_ids: parsed.data.questionIds }),
    };
    const { data, error } = await supabase.rpc("start_answer_run", args);
    if (error !== null) {
      return answerRunErrorResponse(safeAnswerRunRpcCode(error.message));
    }
    const row = data?.[0];
    if (row === undefined) {
      return answerRunErrorResponse("RUN_RPC_FAILED");
    }

    return NextResponse.json({
      status: "ok",
      runId: row.run_id,
      created: row.created,
      requestedCount: row.requested_count,
      skippedCount: row.skipped_count,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return answerRunErrorResponse("AUTH_REQUIRED");
    }
    if (error instanceof ForbiddenError) {
      return answerRunErrorResponse("FORBIDDEN");
    }
    if (error instanceof NotFoundError || isNotFoundError(error)) {
      return answerRunErrorResponse("QUESTIONNAIRE_NOT_FOUND");
    }
    logger.warn("answer run start route failed", {
      name: error instanceof Error ? error.name : "unknown",
      org: orgSlug === "" ? "unknown" : "present",
    });
    return answerRunErrorResponse(safeAnswerRunCode("RUN_RPC_FAILED"));
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
