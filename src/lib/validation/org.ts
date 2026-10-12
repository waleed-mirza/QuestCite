import { z } from "zod";

/**
 * Workspace (organization) input validation.
 *
 * Slug rules (J1 decision D017 — mirrors the DB constraints in
 * 0001_identity_tenancy.sql, which remain authoritative): 3–40 characters,
 * lowercase letters, digits, and hyphens; no leading or trailing hyphen.
 * The reserved list below mirrors `private.reserved_slugs` for instant client
 * feedback only — the database check is the enforcement layer, and any drift
 * surfaces as a mapped SLUG_RESERVED error instead of a bypass.
 */

export const ORG_NAME_MAX = 100;
export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

export const RESERVED_SLUGS: readonly string[] = [
  "app",
  "api",
  "auth",
  "login",
  "logout",
  "signin",
  "signup",
  "signout",
  "callback",
  "onboarding",
  "forgot-password",
  "reset-password",
  "admin",
  "trust",
  "demo",
  "northstar-cloud",
  "settings",
  "members",
  "billing",
  "knowledge",
  "documents",
  "questionnaires",
  "answers",
  "trust-center",
  "access-requests",
  "notifications",
  "platform",
  "new",
  "create",
  "invite",
  "invites",
  "www",
];

export const organizationNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a workspace name.")
  .max(ORG_NAME_MAX, `Workspace name must be at most ${ORG_NAME_MAX} characters.`);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(SLUG_MIN, `Address must be at least ${SLUG_MIN} characters.`)
  .max(SLUG_MAX, `Address must be at most ${SLUG_MAX} characters.`)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "Use lowercase letters, digits, and hyphens only.")
  .refine((slug) => !RESERVED_SLUGS.includes(slug), "That address is reserved — pick another.");

export const createOrganizationSchema = z.object({
  name: organizationNameSchema,
  slug: slugSchema,
});

/** Derives a slug candidate from a workspace name; may need editing to pass. */
export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX);
}
