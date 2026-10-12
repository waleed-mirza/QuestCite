"use server";

import { revalidatePath } from "next/cache";

import { appConfig } from "@/config/app";
import { sendProspectEmail, type EmailDelivery } from "@/lib/email/send";
import { publicSubmitErrorCopy } from "@/features/trust-center/copy";
import {
  trustAccessApprovedEmail,
  trustAccessDeniedEmail,
  trustAccessVerificationEmail,
} from "@/lib/email/templates";
import { logger } from "@/lib/observability/logger";
import { createAccessVerificationToken } from "@/lib/security/verify-token";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugSchema } from "@/lib/validation/org";
import {
  accessRequestInputSchema,
  certificationInputSchema,
  faqInputSchema,
  subprocessorInputSchema,
  trustBrandingSchema,
  trustDocumentInputSchema,
  TC_GRANT_DAYS_DEFAULT,
  type AccessRequestInput,
} from "@/lib/validation/trust-center";
import { prospectContextFromAction } from "@/lib/security/request-context";
import { acceptProspectTerms, submitAccessRequest } from "@/server/services/trust-public";
import { requireOrgRole } from "@/server/authorization/org";
import type { Database } from "@/types/database.types";

/**
 * Trust Center actions (plan §W7). Editor actions are owner/admin; the
 * database re-checks every write (RLS + RPC role assertions). The public
 * submit action is anonymous by design and trusts only the RPC's validation.
 */

export type ActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

/** Approval result: the raw prospect link exists exactly once, here. */
export type ReviewSuccess = {
  status: "approved";
  accessUrl: string;
  expiresHint: string;
};

export type DeniedSuccess = { status: "denied" };

type TrustCenterStatus = Database["public"]["Enums"]["trust_center_status"];

function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function formBool(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function idText(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value !== "" ? value : null;
}

// ---------------------------------------------------------------------------
// Editor: branding + terms + publish state
// ---------------------------------------------------------------------------

export async function saveTrustSlugAction(
  orgSlug: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const parsed = slugSchema.safeParse(formText(formData, "slug"));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the public URL slug." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_trust_center_slug", {
    p_organization_id: ctx.organization.id,
    p_slug: parsed.data,
  });
  if (error !== null) {
    if (error.message.includes("TRUST_SLUG_TAKEN")) {
      return { status: "error", message: "That public URL is already in use." };
    }
    if (error.message.includes("TRUST_SLUG_RESERVED")) {
      return { status: "error", message: "That public URL is reserved — pick another." };
    }
    logger.warn("trust slug update failed", { code: "DATABASE_REJECTED" });
    return { status: "error", message: "Could not save the public URL. Try again." };
  }

  revalidatePath(`/app/${orgSlug}/trust-center`);
  revalidatePath(`/trust/${parsed.data}`);
  return { status: "success", message: "Public URL updated." };
}

export async function saveBrandingAction(
  orgSlug: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const parsed = trustBrandingSchema.safeParse({
    displayName: formText(formData, "displayName"),
    heroTitle: formText(formData, "heroTitle"),
    heroSubtitle: formText(formData, "heroSubtitle"),
    overview: formText(formData, "overview"),
    contactEmail: formText(formData, "contactEmail"),
    logoUrl: formText(formData, "logoUrl"),
    termsVersion: formText(formData, "termsVersion"),
    termsText: formText(formData, "termsText"),
    requireEmailVerification: formBool(formData, "requireEmailVerification"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("trust_centers")
    .update({
      display_name: parsed.data.displayName,
      hero_title: parsed.data.heroTitle,
      hero_subtitle: parsed.data.heroSubtitle,
      overview: parsed.data.overview,
      contact_email: parsed.data.contactEmail,
      logo_url: parsed.data.logoUrl,
      terms_version: parsed.data.termsVersion,
      terms_text: parsed.data.termsText,
      require_email_verification: parsed.data.requireEmailVerification,
    })
    .eq("organization_id", ctx.organization.id);

  if (error !== null) {
    logger.warn("trust branding update failed", { code: "DATABASE_REJECTED" });
    return { status: "error", message: "Could not save. Check the values and try again." };
  }
  revalidatePath(`/app/${orgSlug}/trust-center`);
  return { status: "success", message: "Saved. Publish to make changes live." };
}

const PUBLISH_REQUIREMENT_COPY =
  "Publishing needs a display name, headline, overview (20+ characters), contact email, and terms (version + text of 20+ characters).";

export async function setTrustStatusAction(
  orgSlug: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const status = formText(formData, "status");
  if (status !== "draft" && status !== "preview" && status !== "published") {
    return { status: "error", message: "Unknown status." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_trust_center_status", {
    p_organization_id: ctx.organization.id,
    p_status: status satisfies TrustCenterStatus,
  });
  if (error !== null) {
    if (error.message.includes("PUBLISH_REQUIREMENTS")) {
      return { status: "error", message: PUBLISH_REQUIREMENT_COPY };
    }
    logger.warn("trust status rpc failed", { code: "RPC_REJECTED" });
    return { status: "error", message: "Could not change the status. Try again." };
  }
  revalidatePath(`/app/${orgSlug}/trust-center`);
  revalidatePath(`/trust`);
  return {
    status: "success",
    message:
      status === "published"
        ? "Published — the public page is live."
        : status === "preview"
          ? "Preview mode — members only."
          : "Unpublished — the public page is offline.",
  };
}

// ---------------------------------------------------------------------------
// Editor: content rows (FAQ, certifications, subprocessors, document cards)
// ---------------------------------------------------------------------------

export async function saveFaqAction(
  orgSlug: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const parsed = faqInputSchema.safeParse({
    question: formText(formData, "question"),
    answer: formText(formData, "answer"),
    visible: formBool(formData, "visible"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the FAQ." };
  }
  const supabase = await createSupabaseServerClient();
  const id = idText(formData, "id");
  const { error } = id === null
    ? await supabase.from("trust_center_faqs").insert({
        organization_id: ctx.organization.id,
        question: parsed.data.question,
        answer: parsed.data.answer,
        visible: parsed.data.visible,
      })
    : await supabase
        .from("trust_center_faqs")
        .update({
          question: parsed.data.question,
          answer: parsed.data.answer,
          visible: parsed.data.visible,
        })
        .eq("id", id)
        .eq("organization_id", ctx.organization.id);
  if (error !== null) {
    return { status: "error", message: "Could not save the FAQ." };
  }
  revalidatePath(`/app/${orgSlug}/trust-center`);
  return { status: "success", message: "FAQ saved." };
}

export async function deleteFaqAction(
  orgSlug: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const id = idText(formData, "id");
  if (id === null) {
    return { status: "error", message: "Missing FAQ." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("trust_center_faqs")
    .delete()
    .eq("id", id)
    .eq("organization_id", ctx.organization.id);
  if (error !== null) {
    return { status: "error", message: "Could not delete the FAQ." };
  }
  revalidatePath(`/app/${orgSlug}/trust-center`);
  return { status: "success", message: "FAQ deleted." };
}

export async function saveCertificationAction(
  orgSlug: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const parsed = certificationInputSchema.safeParse({
    name: formText(formData, "name"),
    status: formText(formData, "status"),
    issuer: formText(formData, "issuer"),
    validFrom: formText(formData, "validFrom"),
    validUntil: formText(formData, "validUntil"),
    demo: formBool(formData, "demo"),
    publiclyVisible: formBool(formData, "publiclyVisible"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the certification." };
  }
  if (
    parsed.data.validFrom !== "" &&
    parsed.data.validUntil !== "" &&
    parsed.data.validUntil < parsed.data.validFrom
  ) {
    return { status: "error", message: "The end date must be on or after the start date." };
  }
  const supabase = await createSupabaseServerClient();
  const values = {
    name: parsed.data.name,
    status: parsed.data.status,
    issuer: parsed.data.issuer,
    valid_from: parsed.data.validFrom === "" ? null : parsed.data.validFrom,
    valid_until: parsed.data.validUntil === "" ? null : parsed.data.validUntil,
    demo: parsed.data.demo,
    publicly_visible: parsed.data.publiclyVisible,
  };
  const id = idText(formData, "id");
  const { error } = id === null
    ? await supabase.from("certifications").insert({
        organization_id: ctx.organization.id,
        ...values,
      })
    : await supabase
        .from("certifications")
        .update(values)
        .eq("id", id)
        .eq("organization_id", ctx.organization.id);
  if (error !== null) {
    return { status: "error", message: "Could not save the certification." };
  }
  revalidatePath(`/app/${orgSlug}/trust-center`);
  return { status: "success", message: "Certification saved." };
}

export async function deleteCertificationAction(
  orgSlug: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const id = idText(formData, "id");
  if (id === null) {
    return { status: "error", message: "Missing certification." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("certifications")
    .delete()
    .eq("id", id)
    .eq("organization_id", ctx.organization.id);
  if (error !== null) {
    return { status: "error", message: "Could not delete the certification." };
  }
  revalidatePath(`/app/${orgSlug}/trust-center`);
  return { status: "success", message: "Certification deleted." };
}

export async function saveSubprocessorAction(
  orgSlug: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const parsed = subprocessorInputSchema.safeParse({
    company: formText(formData, "company"),
    purpose: formText(formData, "purpose"),
    dataCategory: formText(formData, "dataCategory"),
    region: formText(formData, "region"),
    publiclyVisible: formBool(formData, "publiclyVisible"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the subprocessor." };
  }
  const supabase = await createSupabaseServerClient();
  const values = {
    company: parsed.data.company,
    purpose: parsed.data.purpose,
    data_category: parsed.data.dataCategory,
    region: parsed.data.region,
    publicly_visible: parsed.data.publiclyVisible,
  };
  const id = idText(formData, "id");
  const { error } = id === null
    ? await supabase.from("subprocessors").insert({ organization_id: ctx.organization.id, ...values })
    : await supabase
        .from("subprocessors")
        .update(values)
        .eq("id", id)
        .eq("organization_id", ctx.organization.id);
  if (error !== null) {
    return { status: "error", message: "Could not save the subprocessor." };
  }
  revalidatePath(`/app/${orgSlug}/trust-center`);
  return { status: "success", message: "Subprocessor saved." };
}

export async function deleteSubprocessorAction(
  orgSlug: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const id = idText(formData, "id");
  if (id === null) {
    return { status: "error", message: "Missing subprocessor." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("subprocessors")
    .delete()
    .eq("id", id)
    .eq("organization_id", ctx.organization.id);
  if (error !== null) {
    return { status: "error", message: "Could not delete the subprocessor." };
  }
  revalidatePath(`/app/${orgSlug}/trust-center`);
  return { status: "success", message: "Subprocessor deleted." };
}

export async function saveTrustDocumentAction(
  orgSlug: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const documentId = idText(formData, "documentId");
  const parsed = trustDocumentInputSchema.safeParse({
    documentId: documentId ?? "",
    description: formText(formData, "description"),
    publiclyRequestable: formBool(formData, "publiclyRequestable"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Pick a document and describe it." };
  }
  const supabase = await createSupabaseServerClient();
  // RLS scopes both tables to the org; a cross-org document id simply fails
  // the insert's FK + policy path and surfaces as the generic error.
  const id = idText(formData, "id");
  const values = {
    document_id: parsed.data.documentId,
    description: parsed.data.description,
    publicly_requestable: parsed.data.publiclyRequestable,
  };
  const { error } = id === null
    ? await supabase.from("trust_center_documents").insert({
        organization_id: ctx.organization.id,
        ...values,
      })
    : await supabase
        .from("trust_center_documents")
        .update(values)
        .eq("id", id)
        .eq("organization_id", ctx.organization.id);
  if (error !== null) {
    logger.warn("trust document card save failed", { code: "DATABASE_REJECTED" });
    return { status: "error", message: "Could not save the document card." };
  }
  revalidatePath(`/app/${orgSlug}/trust-center`);
  return { status: "success", message: "Document card saved." };
}

export async function deleteTrustDocumentAction(
  orgSlug: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const id = idText(formData, "id");
  if (id === null) {
    return { status: "error", message: "Missing document card." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("trust_center_documents")
    .delete()
    .eq("id", id)
    .eq("organization_id", ctx.organization.id);
  if (error !== null) {
    return { status: "error", message: "Could not remove the document card." };
  }
  revalidatePath(`/app/${orgSlug}/trust-center`);
  return { status: "success", message: "Document card removed." };
}

// ---------------------------------------------------------------------------
// Review: approve/deny (J9) — returns the one-time prospect link
// ---------------------------------------------------------------------------

function reviewErrorCopy(code: string): string {
  if (code.includes("REQUEST_NOT_PENDING")) {
    return "This request is no longer awaiting review.";
  }
  if (code.includes("GRANT_DAYS_INVALID")) {
    return "Grant validity must be between 1 and 30 days.";
  }
  if (code.includes("REQUEST_DOCUMENTS_INVALID")) {
    return "Selected documents must be part of the request and still publicly requestable.";
  }
  if (code.includes("FORBIDDEN")) {
    return "Only owners and admins can review requests.";
  }
  return "Could not record the decision. Try again.";
}

export async function reviewAccessRequestAction(
  orgSlug: string,
  trustSlug: string,
  _prev: ActionState | ReviewSuccess | DeniedSuccess | null,
  formData: FormData,
): Promise<ActionState | ReviewSuccess | DeniedSuccess> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);

  const decision = formText(formData, "decision");
  if (decision !== "approved" && decision !== "denied") {
    return { status: "error", message: "Unknown decision." };
  }
  const documentIds = formData
    .getAll("documentId")
    .filter((value): value is string => typeof value === "string" && value !== "");
  const grantDaysRaw = Number(formText(formData, "grantDays") || TC_GRANT_DAYS_DEFAULT);
  const requestId = idText(formData, "requestId");
  if (requestId === null) {
    return { status: "error", message: "Missing request." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: token, error } = await supabase.rpc("review_trust_access_request", {
    p_request_id: requestId,
    p_decision: decision,
    p_document_ids: decision === "denied" ? [] : documentIds,
    p_grant_days: Number.isInteger(grantDaysRaw) ? grantDaysRaw : TC_GRANT_DAYS_DEFAULT,
  });
  if (error !== null) {
    logger.warn("review rpc failed", { code: "RPC_REJECTED" });
    return { status: "error", message: reviewErrorCopy(error.message) };
  }

  const { data: recipient, error: recipientError } = await supabase
    .from("access_requests")
    .select("prospect_email")
    .eq("id", requestId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (recipientError !== null) {
    logger.warn("prospect recipient lookup failed", { code: "DATABASE_READ_FAILED" });
  }
  const prospectEmail = recipient?.prospect_email ?? null;

  // Prospect notification uses the shared log-safe transport (log mode is
  // still the default until an operator configures Resend). The link is
  // rendered once below; the email body carries it to the prospect. Log-mode
  // delivery never touches the address (template key + request id only).
  //
  // Deliberately do not revalidate the current queue here. Approval moves the
  // request from the pending list to the resolved list; revalidation would
  // unmount ReviewForm before its action result can render the raw token. The
  // database state is already committed, and the next navigation refreshes
  // the queue after the owner has copied the one-time link.
  if (decision === "approved" && typeof token === "string" && token !== "") {
    const accessUrl = `/trust/${trustSlug}/access/${token}`;
    const expiresHint = `${grantDaysRaw} day${grantDaysRaw === 1 ? "" : "s"}`;
    await sendProspectEmail({
      ...trustAccessApprovedEmail({
        organizationName: ctx.organization.name,
        accessUrl,
        expiresAt: new Date(Date.now() + grantDaysRaw * 86_400_000),
      }),
      organizationId: ctx.organization.id,
      requestId,
      toEmail: prospectEmail,
    });
    return { status: "approved", accessUrl, expiresHint };
  }

  const denialDelivery: EmailDelivery = await sendProspectEmail({
    ...trustAccessDeniedEmail({ organizationName: ctx.organization.name }),
    organizationId: ctx.organization.id,
    requestId,
    toEmail: prospectEmail,
  });
  if (denialDelivery === "skipped") {
    logger.info("prospect denial email skipped", { requestId: requestId.slice(0, 8) });
  }
  return { status: "denied" };
}

export async function revokeGrantAction(
  orgSlug: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  await requireOrgRole(["owner", "admin"], orgSlug);
  const grantId = idText(formData, "grantId");
  if (grantId === null) {
    return { status: "error", message: "Missing grant." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("revoke_access_grant", { p_grant_id: grantId });
  if (error !== null) {
    return { status: "error", message: "Could not revoke this grant. It may already be inactive." };
  }
  revalidatePath(`/app/${orgSlug}/access-requests`);
  return { status: "success", message: "Grant revoked." };
}

// ---------------------------------------------------------------------------
// Public: prospect request submission (J8) — anonymous
// ---------------------------------------------------------------------------

export type PublicSubmitState =
  | { status: "idle" }
  | { status: "submitted"; requiresEmailVerification: boolean }
  | { status: "error"; message: string };

export async function submitAccessRequestAction(
  slug: string,
  _prev: PublicSubmitState | null,
  formData: FormData,
): Promise<PublicSubmitState> {
  const documentIds = formData
    .getAll("documentId")
    .filter((value): value is string => typeof value === "string" && value !== "");
  const parsed = accessRequestInputSchema.safeParse({
    name: formText(formData, "name"),
    company: formText(formData, "company"),
    email: formText(formData, "email"),
    documentIds,
    acceptTerms: formData.get("acceptTerms") === "on",
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const input: AccessRequestInput = parsed.data;
  const context = await prospectContextFromAction();
  const result = await submitAccessRequest(slug, input, context);
  if (result.status === "error") {
    return { status: "error", message: publicSubmitErrorCopy(result.code) };
  }
  if (result.requiresEmailVerification) {
    const verificationToken = createAccessVerificationToken(result.requestId);
    const verificationUrl = new URL(
      `/trust/${encodeURIComponent(slug)}/verify/${verificationToken}`,
      appConfig.url,
    ).toString();
    await sendProspectEmail({
      ...trustAccessVerificationEmail({
        verificationUrl,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }),
      requestId: result.requestId,
      toEmail: input.email,
    });
  }
  return {
    status: "submitted",
    requiresEmailVerification: result.requiresEmailVerification,
  };
}

export type AcceptTermsState =
  | { status: "idle" }
  | { status: "accepted" }
  | { status: "error"; message: string };

/**
 * Prospect re-acceptance of CHANGED terms from the gated page (J9 step 4:
 * "accepts terms if not already recorded"). The download RPC enforces the
 * current-version acceptance (migration 0022) — this action is the compliant
 * path to satisfy it, recording version + hash server-side.
 */
export async function acceptProspectTermsAction(
  slug: string,
  rawToken: string,
  _prev: AcceptTermsState | null,
  formData: FormData,
): Promise<AcceptTermsState> {
  if (formData.get("acceptTerms") !== "on") {
    return { status: "error", message: "Please accept the terms to enable downloads." };
  }
  const result = await acceptProspectTerms(slug, rawToken);
  if (result.status !== "ok") {
    return { status: "error", message: "This link is no longer valid. Request access again." };
  }
  revalidatePath(`/trust/${slug}/access/${rawToken}`);
  return { status: "accepted" };
}
