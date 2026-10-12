"use server";

import { appConfig } from "@/config/app";
import { sendEmail } from "@/lib/email/send";
import { memberInviteEmail } from "@/lib/email/templates";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/validation/auth";
import { generateInviteToken } from "@/features/members/server";
import { requireOrgRole, type AppRole } from "@/server/authorization/org";
import { requireUser } from "@/server/auth/session";

/**
 * Member management actions (plan §W2, PRD §5 permission matrix, journey J2).
 *
 * Guards: owner/admin for everything here; the DATABASE additionally enforces
 * that admins never touch owners or themselves, that invites never carry the
 * owner role, and that the final owner cannot be removed (trigger). RLS is
 * the final enforcement layer.
 */

export type ActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export type InviteSuccess = {
  /** Distinct discriminator so forms can branch between result kinds. */
  status: "invited";
  /** One-time link shown once after creation — never logged, never re-fetched. */
  inviteUrl: string;
  email: string;
};

const INVITE_EXPIRY_DAYS = 7;
const ASSIGNABLE_ROLES: readonly AppRole[] = ["admin", "reviewer", "viewer"];

function isAssignableRole(value: string): value is AppRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

export async function inviteMemberAction(
  orgSlug: string,
  _prev: ActionState | InviteSuccess | null,
  formData: FormData,
): Promise<ActionState | InviteSuccess> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const actor = await requireUser();

  const email = emailSchema.safeParse(formData.get("email"));
  const role = formData.get("role");
  if (!email.success || typeof role !== "string" || !isAssignableRole(role)) {
    return { status: "error", message: "Enter a valid email and role." };
  }

  const supabase = await createSupabaseServerClient();
  const { token, tokenHash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 86_400_000).toISOString();

  const { data: invite, error } = await supabase
    .from("organization_invites")
    .insert({
      organization_id: ctx.organization.id,
      email: email.data,
      role,
      token_hash: tokenHash,
      invited_by: actor.userId,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error !== null || invite === null) {
    const code = error?.message ?? "";
    if (error?.code === "23505" || code.includes("duplicate key")) {
      return { status: "error", message: "There is already a pending invitation for that email." };
    }
    logger.warn("invite insert failed", { code: code.slice(0, 60) });
    return { status: "error", message: "We couldn't create the invitation. Please try again." };
  }

  // Audit events are forensics, not the source of truth — a failed audit write
  // is logged but must not roll the invite back (two PostgREST calls, no tx).
  const { error: auditError } = await supabase.from("audit_events").insert({
    organization_id: ctx.organization.id,
    actor_id: actor.userId,
    action: "member.invited",
    entity_type: "organization_invite",
    entity_id: invite.id,
    metadata: { role, invited_email: email.data },
  });
  if (auditError !== null) {
    logger.warn("invite audit write failed", { code: auditError.message.slice(0, 60) });
  }

  const inviteUrl = `/invite/${token}`;
  const delivery = await sendEmail({
    ...memberInviteEmail({
      organizationName: ctx.organization.name,
      inviterName: actor.email,
      inviteUrl: `${appConfig.url}${inviteUrl}`,
      expiresAt: new Date(expiresAt),
    }),
    toUserId: invite.id,
    toEmail: email.data,
    organizationId: ctx.organization.id,
  });
  if (delivery === "failed") {
    // The invitation row and one-time link remain usable when an email
    // provider is unavailable; the UI still gives the inviter the link once.
    logger.warn("invite email delivery failed", { organizationId: ctx.organization.id, inviteId: invite.id });
  }

  return {
    status: "invited",
    email: email.data,
    inviteUrl,
  };
}

export async function changeMemberRoleAction(orgSlug: string, formData: FormData): Promise<void> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const actor = await requireUser();

  const userId = formData.get("userId");
  const role = formData.get("role");
  if (typeof userId !== "string" || userId === "" || typeof role !== "string" || !isAssignableRole(role)) {
    return;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("organization_members")
    .update({ role })
    .eq("organization_id", ctx.organization.id)
    .eq("user_id", userId);

  if (error === null) {
    await supabase.from("audit_events").insert({
      organization_id: ctx.organization.id,
      actor_id: actor.userId,
      action: "member.role_changed",
      entity_type: "organization_member",
      entity_id: userId,
      metadata: { role },
    });
  }
}

export async function removeMemberAction(orgSlug: string, formData: FormData): Promise<void> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const actor = await requireUser();

  const userId = formData.get("userId");
  if (typeof userId !== "string" || userId === "" || userId === actor.userId) {
    // Removing yourself is a distinct flow (and the final owner is protected
    // by the DB trigger); keep the button from even attempting it.
    return;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("organization_members")
    .delete()
    .eq("organization_id", ctx.organization.id)
    .eq("user_id", userId);

  if (error === null) {
    await supabase.from("audit_events").insert({
      organization_id: ctx.organization.id,
      actor_id: actor.userId,
      action: "member.removed",
      entity_type: "organization_member",
      entity_id: userId,
    });
  }
}

export async function revokeInviteAction(orgSlug: string, formData: FormData): Promise<void> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const inviteId = formData.get("inviteId");
  if (typeof inviteId !== "string" || inviteId === "") {
    return;
  }
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("revoke_organization_invite", {
    p_organization_id: ctx.organization.id,
    p_invite_id: inviteId,
  });
}
