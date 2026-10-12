import "server-only";

import { z } from "zod";

import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AccessRequestInput, TrustPublicErrorCode } from "@/lib/validation/trust-center";
import type { ProspectRequestContext } from "@/lib/security/request-context";

/**
 * PUBLIC Trust Center read service (plan §W7 "public read service returning
 * an allowlisted response shape" + the W7 gate: nothing private can leak
 * through public pages or downloads).
 *
 * Defense in depth, three layers deep:
 *   1. Anonymous callers have NO table grants — the only read surface is the
 *      SECURITY DEFINER RPC get_trust_center_overview, which hand-builds the
 *      allowlisted payload in SQL (published rows only).
 *   2. This module re-validates that payload against the Zod allowlist below
 *      — a schema change upstream can never smuggle a new field onto a public
 *      page, because unknown keys are stripped and expected keys are typed.
 *   3. The page renders only from this typed shape.
 */

// ---------------------------------------------------------------------------
// The allowlist (the single public contract — pinned by unit tests)
// ---------------------------------------------------------------------------

export const publicFaqSchema = z.object({
  question: z.string().max(300),
  answer: z.string().max(2000),
});

export const publicCertificationSchema = z.object({
  name: z.string().max(120),
  status: z.enum(["active", "expired", "planned"]),
  issuer: z.string().max(120).nullable(),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
  demo: z.boolean(),
});

export const publicSubprocessorSchema = z.object({
  company: z.string().max(160),
  purpose: z.string().max(300),
  dataCategory: z.string().max(160),
  region: z.string().max(120),
});

export const publicDocumentCardSchema = z.object({
  documentId: z.uuid(),
  title: z.string().max(200),
  description: z.string().max(500),
  category: z.string().max(80),
});

export const publicTrustCenterSchema = z.object({
  slug: z.string().min(3).max(40),
  displayName: z.string().max(120).nullable(),
  heroTitle: z.string().max(160).nullable(),
  heroSubtitle: z.string().max(240).nullable(),
  overview: z.string().max(4000).nullable(),
  contactEmail: z.string().max(254).nullable(),
  logoUrl: z.string().max(500).nullable(),
  /** Clickwrap contract displayed at request time (public by design). */
  termsVersion: z.string().max(40),
  termsText: z.string().max(20000),
  faqs: z.array(publicFaqSchema),
  certifications: z.array(publicCertificationSchema),
  subprocessors: z.array(publicSubprocessorSchema),
  documents: z.array(publicDocumentCardSchema),
});

export type PublicTrustCenter = z.infer<typeof publicTrustCenterSchema>;

// ---------------------------------------------------------------------------
// Stable error codes surfaced to public copy (mapped from RPC exceptions) —
// the type lives in the client-safe validation module; codes mirror migration
// 0021's exception messages.
// ---------------------------------------------------------------------------

const KNOWN_CODES: ReadonlySet<string> = new Set([
  "TRUST_CENTER_NOT_FOUND",
  "REQUEST_INPUT_INVALID",
  "REQUEST_DOCUMENTS_INVALID",
  "TERMS_NOT_ACCEPTED",
  "TERMS_NOT_CONFIGURED",
  "RATE_LIMITED",
  "ACCESS_LINK_INVALID",
  "ACCESS_LINK_EXPIRED",
  "DOWNLOAD_NOT_ALLOWED",
]);

/**
 * RPC rejections arrive as the exception MESSAGE (migration convention). A
 * message that is not one of the known codes maps to UNAVAILABLE — the raw
 * string must never reach a public page (rule 8: errors never expose SQL or
 * internals).
 */
export function mapRpcErrorCode(rawMessage: string | undefined | null): TrustPublicErrorCode {
  const code = (rawMessage ?? "").trim();
  return KNOWN_CODES.has(code) ? (code as TrustPublicErrorCode) : "UNAVAILABLE";
}

// ---------------------------------------------------------------------------
// Public overview
// ---------------------------------------------------------------------------

/**
 * The published Trust Center for a slug, or null. Unknown and unpublished
 * slugs are indistinguishable here on purpose (J8 failure path: "no
 * existence leak"). Validation failures of a PUBLISHED payload are logged
 * (code only) and treated as not-published — fail closed.
 */
export async function getPublicTrustCenter(slug: string): Promise<PublicTrustCenter | null> {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug) || slug.length < 3 || slug.length > 40) {
    return null;
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_trust_center_overview", { p_slug: slug });
  if (error !== null) {
    logger.warn("trust overview rpc failed", { slug: slug.slice(0, 40), code: mapRpcErrorCode(error.message) });
    return null;
  }
  if (data === null) {
    return null;
  }
  const parsed = publicTrustCenterSchema.safeParse(data);
  if (!parsed.success) {
    logger.warn("trust overview payload failed allowlist", { slug: slug.slice(0, 40) });
    return null;
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Prospect gated view (the /trust/{slug}/access/{token} page)
// ---------------------------------------------------------------------------

const prospectDocumentsSchema = z.object({
  displayName: z.string().max(120).nullable(),
  termsVersion: z.string().max(40),
  termsText: z.string().max(20000),
  termsCurrent: z.boolean(),
  requestExpiresAt: z.string(),
  documents: z.array(
    z.object({
      documentId: z.uuid(),
      title: z.string().max(200),
      description: z.string().max(500),
      filename: z.string().max(200),
      byteSize: z.number().int().positive(),
      expiresAt: z.string(),
    }),
  ),
});

export type ProspectDocuments = z.infer<typeof prospectDocumentsSchema>;

export type ProspectView =
  | { status: "ok"; data: ProspectDocuments }
  | { status: "expired" }
  | { status: "invalid" };

function prospectViewError(message: string | undefined | null): Exclude<ProspectView, { status: "ok" }> {
  const code = mapRpcErrorCode(message);
  if (code === "ACCESS_LINK_EXPIRED") {
    return { status: "expired" };
  }
  // Every other failure (unknown token, wrong slug, denied, malformed) is the
  // same generic answer — tokens must not be enumerable or cross-usable.
  return { status: "invalid" };
}

export async function getProspectDocuments(slug: string, rawToken: string): Promise<ProspectView> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("trust_prospect_documents", {
    p_slug: slug,
    p_raw_token: rawToken,
  });
  if (error !== null) {
    return prospectViewError(error.message);
  }
  const parsed = prospectDocumentsSchema.safeParse(data);
  if (!parsed.success) {
    logger.warn("trust prospect payload failed allowlist", { slug: slug.slice(0, 40) });
    return { status: "invalid" };
  }
  return { status: "ok", data: parsed.data };
}

/** Prospect re-accepts (changed) terms from the gated page before downloading. */
export async function acceptProspectTerms(
  slug: string,
  rawToken: string,
): Promise<{ status: "ok" } | { status: "invalid" } | { status: "expired" }> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("trust_accept_terms", {
    p_slug: slug,
    p_raw_token: rawToken,
  });
  if (error !== null) {
    const code = mapRpcErrorCode(error.message);
    return code === "ACCESS_LINK_EXPIRED" ? { status: "expired" } : { status: "invalid" };
  }
  return { status: "ok" };
}

// ---------------------------------------------------------------------------
// Gated download (validated by RPC; the route signs the returned path)
// ---------------------------------------------------------------------------

export type TrustDownload =
  | { status: "ok"; storagePath: string; filename: string; mimeType: string }
  | { status: "expired" }
  | { status: "invalid" };

export async function authorizeTrustDownload(
  slug: string,
  rawToken: string,
  documentId: string,
  context: ProspectRequestContext,
): Promise<TrustDownload> {
  const supabase = await createSupabaseServerClient();
  // The RPC args are non-null text; "" is normalized to NULL inside the RPC
  // (nullif pattern) — same wire shape, type-safe call.
  const { data, error } = await supabase.rpc("trust_download_document", {
    p_slug: slug,
    p_raw_token: rawToken,
    p_document_id: documentId,
    p_ip_hash: context.ipHash ?? "",
    p_ua_summary: context.uaSummary ?? "",
  });
  if (error !== null) {
    const code = mapRpcErrorCode(error.message);
    if (code === "ACCESS_LINK_EXPIRED") {
      return { status: "expired" };
    }
    // DOWNLOAD_NOT_ALLOWED (wrong doc/no grant), ACCESS_LINK_INVALID, and
    // anything unexpected share one generic denial.
    return { status: "invalid" };
  }
  const parsed = z
    .object({ storagePath: z.string().min(1), filename: z.string().min(1), mimeType: z.string().min(1) })
    .safeParse(data);
  if (!parsed.success) {
    return { status: "invalid" };
  }
  return { status: "ok", ...parsed.data };
}

// ---------------------------------------------------------------------------
// Request submission (J8)
// ---------------------------------------------------------------------------

export type AccessRequestResult =
  | { status: "submitted"; requestId: string; requiresEmailVerification: boolean }
  | { status: "error"; code: TrustPublicErrorCode };

const accessRequestSubmissionResultSchema = z.object({
  requestId: z.uuid(),
  requiresEmailVerification: z.boolean(),
});

/**
 * Anonymous prospect submission. All authorization lives in the RPC
 * (published check, document requestability, clickwrap terms, atomic rate
 * limits); this wrapper passes the validated input + hashed request context.
 */
export async function submitAccessRequest(
  slug: string,
  input: AccessRequestInput,
  context: ProspectRequestContext,
): Promise<AccessRequestResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("submit_trust_access_request_result", {
    p_slug: slug,
    p_name: input.name,
    p_company: input.company,
    p_email: input.email,
    p_document_ids: input.documentIds,
    p_accept_terms: input.acceptTerms,
    // "" → NULL inside the RPC (nullif): absent IP/UA is a first-class case.
    p_ip_hash: context.ipHash ?? "",
    p_ua_summary: context.uaSummary ?? "",
  });
  if (error !== null) {
    return { status: "error", code: mapRpcErrorCode(error.message) };
  }
  const parsed = accessRequestSubmissionResultSchema.safeParse(data);
  if (!parsed.success) {
    logger.warn("trust request result failed allowlist", { slug: slug.slice(0, 40) });
    return { status: "error", code: "UNAVAILABLE" };
  }
  return { status: "submitted", ...parsed.data };
}

/** Idempotent email-verification flip (D029) — called after HMAC verification. */
export async function confirmAccessRequest(requestId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("confirm_trust_access_request", { p_request_id: requestId });
}
