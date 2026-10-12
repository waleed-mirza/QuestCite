"use server";

import { redirect } from "next/navigation";

import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/lib/validation/auth";
import { createOrganizationSchema } from "@/lib/validation/org";
import type { FormState } from "@/features/auth/actions";
import { requireUser } from "@/server/auth/session";

/**
 * Onboarding: atomic workspace creation (journey J1 step 5). The RPC inserts
 * the organization, the owner membership, the default trust center, and the
 * audit event in ONE transaction — a failure leaves no ownerless workspace.
 */

const GENERIC_ERROR = "We couldn't create your workspace. Please try again.";
const INPUT_INVALID = "Check the workspace name and address.";

const RPC_ERROR_MESSAGES: Record<string, string> = {
  SLUG_TAKEN: "That workspace address is already taken — pick another.",
  SLUG_RESERVED: "That address is reserved — pick another.",
  ORG_INPUT_INVALID: INPUT_INVALID,
  EMAIL_NOT_VERIFIED: "Verify your email address before creating a workspace.",
};

export async function createOrganizationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser();

  const parsed = createOrganizationSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Check the highlighted fields.", fields: fieldErrors(parsed.error) };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("create_organization_with_owner", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
  });

  if (error !== null) {
    const code = error.message ?? "";
    const mapped = RPC_ERROR_MESSAGES[code];
    if (mapped !== undefined) {
      return { status: "error", message: mapped };
    }
    // Constraint backstops (name/slug shape) surface raw constraint names —
    // map them without echoing provider text (AGENTS.md rule 8).
    if (code.includes("organizations_slug_check") || code.includes("organizations_name_check")) {
      return { status: "error", message: INPUT_INVALID };
    }
    logger.warn("create_organization_with_owner failed", { code: code.slice(0, 60) });
    return { status: "error", message: GENERIC_ERROR };
  }

  redirect(`/app/${parsed.data.slug}`);
}
