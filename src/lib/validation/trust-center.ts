import { z } from "zod";

/**
 * Trust Center input validation (plan §W7, AGENTS.md rule 6). Mirrors the DB
 * CHECK constraints in 0021_trust_center_public_access.sql, which remain the
 * authoritative layer — the app schema gives instant, copy-friendly feedback
 * and stops junk before the RPC.
 *
 * Every public input here is written by a prospect or an admin and rendered
 * back on a PUBLIC page: React escaping is the render-time defense and these
 * caps keep payloads bounded, but the stored-XSS guarantee itself is pinned
 * by tests (plan §W7 "stored-XSS tests for names, FAQs, descriptions").
 */

export const TC_NAME_MAX = 120;
export const TC_COMPANY_MAX = 160;
export const EMAIL_MAX = 254;

export const TC_DISPLAY_NAME_MAX = 120;
export const TC_HERO_TITLE_MAX = 160;
export const TC_HERO_SUBTITLE_MAX = 240;
export const TC_OVERVIEW_MAX = 4000;
export const TC_TERMS_VERSION_MAX = 40;
export const TC_TERMS_TEXT_MAX = 20000;
export const TC_LOGO_URL_MAX = 500;

export const TC_FAQ_QUESTION_MAX = 300;
export const TC_FAQ_ANSWER_MAX = 2000;

export const TC_CERT_NAME_MAX = 120;
export const TC_CERT_ISSUER_MAX = 120;

export const TC_SUB_COMPANY_MAX = 160;
export const TC_SUB_PURPOSE_MAX = 300;
export const TC_SUB_CATEGORY_MAX = 160;
export const TC_SUB_REGION_MAX = 120;

export const TC_DOC_DESCRIPTION_MAX = 500;

export const TC_MAX_DOCUMENTS_PER_REQUEST = 20;
export const TC_GRANT_DAYS_MIN = 1;
export const TC_GRANT_DAYS_MAX = 30;
export const TC_GRANT_DAYS_DEFAULT = 7;

export const certStatusSchema = z.enum(["active", "expired", "planned"]);
export type CertStatus = z.infer<typeof certStatusSchema>;

const trimmed = (max: number, label: string, min = 1) =>
  z
    .string()
    .trim()
    .min(min, min === 1 ? `Enter ${label}.` : `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be at most ${max} characters.`);

const optionalTrimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .transform((value) => (value === "" ? null : value));

export const trustBrandingSchema = z.object({
  displayName: trimmed(TC_DISPLAY_NAME_MAX, "a display name"),
  heroTitle: trimmed(TC_HERO_TITLE_MAX, "a headline"),
  heroSubtitle: optionalTrimmed(TC_HERO_SUBTITLE_MAX, "The subtitle"),
  overview: trimmed(TC_OVERVIEW_MAX, "a security overview", 20),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(EMAIL_MAX, `Contact email must be at most ${EMAIL_MAX} characters.`)
    .pipe(z.email({ message: "Enter a valid contact email." })),
  logoUrl: z
    .string()
    .trim()
    .max(TC_LOGO_URL_MAX, `Logo URL must be at most ${TC_LOGO_URL_MAX} characters.`)
    .refine((value) => value === "" || value.startsWith("https://"), "Logo URL must use https://")
    .transform((value) => (value === "" ? null : value)),
  termsVersion: trimmed(TC_TERMS_VERSION_MAX, "a terms version"),
  termsText: trimmed(TC_TERMS_TEXT_MAX, "the terms text", 20),
  requireEmailVerification: z.boolean(),
});

export const faqInputSchema = z.object({
  question: trimmed(TC_FAQ_QUESTION_MAX, "a question"),
  answer: trimmed(TC_FAQ_ANSWER_MAX, "an answer"),
  visible: z.boolean(),
});

export const certificationInputSchema = z.object({
  name: trimmed(TC_CERT_NAME_MAX, "a certification name"),
  status: certStatusSchema,
  issuer: optionalTrimmed(TC_CERT_ISSUER_MAX, "The issuer"),
  validFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$|^$/, "Use YYYY-MM-DD or leave blank."),
  validUntil: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$|^$/, "Use YYYY-MM-DD or leave blank."),
  demo: z.boolean(),
  publiclyVisible: z.boolean(),
});

export const subprocessorInputSchema = z.object({
  company: trimmed(TC_SUB_COMPANY_MAX, "a company name"),
  purpose: trimmed(TC_SUB_PURPOSE_MAX, "a purpose"),
  dataCategory: trimmed(TC_SUB_CATEGORY_MAX, "a data category"),
  region: trimmed(TC_SUB_REGION_MAX, "a region"),
  publiclyVisible: z.boolean(),
});

export const trustDocumentInputSchema = z.object({
  documentId: z.uuid({ message: "Pick a document." }),
  description: trimmed(TC_DOC_DESCRIPTION_MAX, "a description"),
  publiclyRequestable: z.boolean(),
});

/** Prospect request form (journey J8). */
export const accessRequestInputSchema = z.object({
  name: trimmed(TC_NAME_MAX, "your name"),
  company: trimmed(TC_COMPANY_MAX, "your company"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(EMAIL_MAX, `Email must be at most ${EMAIL_MAX} characters.`)
    .pipe(z.email({ message: "Enter a valid work email." })),
  documentIds: z
    .array(z.uuid({ message: "Invalid document selection." }))
    .min(1, "Select at least one document.")
    .max(TC_MAX_DOCUMENTS_PER_REQUEST, `Select at most ${TC_MAX_DOCUMENTS_PER_REQUEST} documents.`),
  acceptTerms: z.literal(true, { message: "You must accept the terms to continue." }),
});

export type AccessRequestInput = z.infer<typeof accessRequestInputSchema>;

/** Admin decision form (journey J9). */
export const accessReviewSchema = z
  .object({
    decision: z.enum(["approved", "denied"]),
    documentIds: z.array(z.uuid()).max(TC_MAX_DOCUMENTS_PER_REQUEST),
    grantDays: z.number().int().min(TC_GRANT_DAYS_MIN).max(TC_GRANT_DAYS_MAX),
  })
  .refine(
    (data) => data.decision === "denied" || data.documentIds.length >= 1,
    { message: "Select at least one document to grant.", path: ["documentIds"] },
  );

export type AccessReviewInput = z.infer<typeof accessReviewSchema>;

/**
 * Stable public error codes (mirrors the RPC exception messages in migration
 * 0021). Declared here — a client-safe module — so public copy can map codes
 * without importing server code.
 */
export type TrustPublicErrorCode =
  | "TRUST_CENTER_NOT_FOUND"
  | "REQUEST_INPUT_INVALID"
  | "REQUEST_DOCUMENTS_INVALID"
  | "TERMS_NOT_ACCEPTED"
  | "TERMS_NOT_CONFIGURED"
  | "RATE_LIMITED"
  | "ACCESS_LINK_INVALID"
  | "ACCESS_LINK_EXPIRED"
  | "DOWNLOAD_NOT_ALLOWED"
  | "UNAVAILABLE";
