import { NextResponse } from "next/server";

import { getAnswerAvailability } from "@/lib/ai/answer-provider";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { answerRunRetryRequestSchema } from "@/lib/validation/answer-runs";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/server/errors";
import { requireOrgRole } from "@/server/authorization/org";
import { getAnswerRunSnapshot } from "@/features/questionnaires/ai-server";
import { safeAnswerRunRpcCode } from "@/server/services/answer-run-gateway";
import { answerRunErrorResponse } from "@/server/services/answer-run-http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  try {
    const { runId } = await params;
    if (!isUuid(runId)) {
      return answerRunErrorResponse("RUN_INPUT_INVALID");
    }
    const parsed = answerRunRetryRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return answerRunErrorResponse("RUN_INPUT_INVALID");
    }
    const ctx = await requireOrgRole(["owner", "admin", "reviewer"], parsed.data.orgSlug);
    const availability = getAnswerAvailability();
    if (availability === "disabled") return answerRunErrorResponse("AI_DISABLED");
    if (availability === "not_configured") return answerRunErrorResponse("AI_NOT_CONFIGURED");

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("retry_answer_run_item", {
      p_organization_id: ctx.organization.id,
      p_run_id: runId,
      p_item_id: parsed.data.itemId,
    });
    if (error !== null) {
      return answerRunErrorResponse(safeAnswerRunRpcCode(error.message));
    }
    const run = await getAnswerRunSnapshot(ctx.organization.id, runId);
    return run === null
      ? answerRunErrorResponse("RUN_NOT_FOUND")
      : NextResponse.json({ status: "ok", run });
  } catch (error) {
    if (error instanceof UnauthorizedError) return answerRunErrorResponse("AUTH_REQUIRED");
    if (error instanceof ForbiddenError) return answerRunErrorResponse("FORBIDDEN");
    if (error instanceof NotFoundError) return answerRunErrorResponse("RUN_NOT_FOUND");
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
