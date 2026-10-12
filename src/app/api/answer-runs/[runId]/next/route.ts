import { NextResponse } from "next/server";

import { getAnswerAvailability, getAnswerProvider } from "@/lib/ai/answer-provider";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { answerRunNextRequestSchema } from "@/lib/validation/answer-runs";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/server/errors";
import { requireOrgRole } from "@/server/authorization/org";
import { getAnswerRunSnapshot } from "@/features/questionnaires/ai-server";
import { processNextAnswerRun, AnswerRunProcessingError, DEFAULT_CLAIM_BATCH_SIZE } from "@/server/services/answer-run";
import { createAnswerRunGateway } from "@/server/services/answer-run-gateway";
import { answerRunErrorResponse, safeAnswerRunCode } from "@/server/services/answer-run-http";
import { retrieveEvidenceForQuestion } from "@/server/services/retrieval";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  try {
    const { runId } = await params;
    if (!isUuid(runId)) {
      return answerRunErrorResponse("RUN_INPUT_INVALID");
    }
    const parsed = answerRunNextRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return answerRunErrorResponse("RUN_INPUT_INVALID");
    }

    const ctx = await requireOrgRole(["owner", "admin", "reviewer"], parsed.data.orgSlug);
    const availability = getAnswerAvailability();
    if (availability === "disabled") {
      return answerRunErrorResponse("AI_DISABLED");
    }
    if (availability === "not_configured") {
      return answerRunErrorResponse("AI_NOT_CONFIGURED");
    }
    const provider = getAnswerProvider();
    if (provider === null) {
      return answerRunErrorResponse("AI_NOT_CONFIGURED");
    }

    const before = await getAnswerRunSnapshot(ctx.organization.id, runId);
    if (before === null) {
      return answerRunErrorResponse("RUN_NOT_FOUND");
    }
    const env = getServerEnv();
    const supabase = await createSupabaseServerClient();
    const result = await processNextAnswerRun({
      gateway: createAnswerRunGateway(supabase),
      organizationId: ctx.organization.id,
      runId,
      batchSize: parsed.data.batchSize || DEFAULT_CLAIM_BATCH_SIZE,
      model: env.OPENAI_ANSWER_MODEL,
      provider,
      maxInputTokens: env.AI_MAX_INPUT_TOKENS_PER_RUN,
      inputTokensUsed: before.inputTokens,
      maxOutputTokens: Math.min(env.AI_MAX_OUTPUT_TOKENS_PER_RUN, 1_200),
      retrieveEvidence: ({ organizationId, questionText, category }) =>
        retrieveEvidenceForQuestion({
          supabase,
          organizationId,
          questionText,
          contextTags: category.trim() === "" ? [] : [category],
        }),
    });
    const run = await getAnswerRunSnapshot(ctx.organization.id, runId);
    if (run === null) {
      return answerRunErrorResponse("RUN_NOT_FOUND");
    }
    return NextResponse.json({ status: "ok", processed: result, run });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return answerRunErrorResponse("AUTH_REQUIRED");
    }
    if (error instanceof ForbiddenError) {
      return answerRunErrorResponse("FORBIDDEN");
    }
    if (error instanceof NotFoundError) {
      return answerRunErrorResponse("RUN_NOT_FOUND");
    }
    if (error instanceof AnswerRunProcessingError) {
      return answerRunErrorResponse(safeAnswerRunCode(error.code));
    }
    logger.warn("answer run next route failed", { name: error instanceof Error ? error.name : "unknown" });
    return answerRunErrorResponse("RUN_RPC_FAILED");
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
