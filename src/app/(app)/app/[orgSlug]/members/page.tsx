import { Trash2, UserMinus } from "lucide-react";

import { AccessDenied } from "@/components/feedback/access-denied";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InviteForm } from "@/features/members/components/invite-form";
import {
  changeMemberRoleAction,
  removeMemberAction,
  revokeInviteAction,
} from "@/features/members/actions";
import { listMembers, listPendingInvites } from "@/features/members/server";
import { guardOrgRoles } from "@/server/authorization/guard";

/**
 * Members surface (plan §W2, PRD §5): member directory with role management,
 * pending invitations with revocation, and the invite form — owner/admin
 * only. Every control's server action re-checks role and RLS, and the final
 * owner is protected by the database trigger.
 */
export default async function MembersPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const guard = await guardOrgRoles(orgSlug, ["owner", "admin"]);
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return null; // proxy/layout already handles sign-in routing
    }
    if (guard.reason === "forbidden") {
      return <AccessDenied what="member management" />;
    }
    return <Card>
      <CardHeader>
        <h1 className="text-lg font-semibold">Workspace not found</h1>
        <CardDescription>You may not be a member of this workspace.</CardDescription>
      </CardHeader>
    </Card>;
  }

  const [members, invites] = await Promise.all([listMembers(), listPendingInvites()]);
  const isOwner = guard.ctx.role === "owner";

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-muted-foreground mt-1">
          People with access to {guard.ctx.organization.name}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invite a team member</CardTitle>
          <CardDescription>Admins manage day-to-day work; reviewers approve answers; viewers read.</CardDescription>
        </CardHeader>
        <CardContent>
          <InviteForm orgSlug={orgSlug} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
          <CardDescription>Revoking a link makes it unusable immediately.</CardDescription>
        </CardHeader>
        <CardContent>
          {invites.length === 0 ? (
            <p className="text-muted-foreground text-sm">No pending invitations.</p>
          ) : (
            <ul className="divide-border/60 divide-y">
              {invites.map((invite) => {
                return (
                  <li key={invite.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{invite.email}</p>
                      <p className="text-muted-foreground text-xs capitalize">
                        {invite.role} ·{" "}
                        {invite.expired
                          ? "expired"
                          : `expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    <form action={revokeInviteAction.bind(null, orgSlug)}>
                      <input type="hidden" name="inviteId" value={invite.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        <Trash2 aria-hidden="true" />
                        Revoke
                      </Button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>
            {isOwner
              ? "As the owner you can change any role — the last owner cannot be removed."
              : "Admins can manage non-owner members and cannot change their own role."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-border/60 divide-y">
            {members.map((member) => (
              <li key={member.userId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{member.fullName !== "" ? member.fullName : member.email}</p>
                  {member.fullName !== "" ? (
                    <p className="text-muted-foreground truncate text-xs">{member.email}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <form action={changeMemberRoleAction.bind(null, orgSlug)} className="flex items-center gap-1">
                    <input type="hidden" name="userId" value={member.userId} />
                    <label className="sr-only" htmlFor={`role-${member.userId}`}>
                      Role for {member.email}
                    </label>
                    <select
                      id={`role-${member.userId}`}
                      name="role"
                      defaultValue={member.role}
                      disabled={member.role === "owner"}
                      className="border-input h-8 rounded-lg border bg-transparent px-2 text-sm disabled:opacity-50"
                    >
                      {member.role === "owner" ? <option value="owner">Owner</option> : null}
                      <option value="admin">Admin</option>
                      <option value="reviewer">Reviewer</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <Button type="submit" variant="ghost" size="sm" disabled={member.role === "owner"}>
                      Save
                    </Button>
                  </form>
                  <form action={removeMemberAction.bind(null, orgSlug)}>
                    <input type="hidden" name="userId" value={member.userId} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      disabled={member.role === "owner"}
                      aria-label={`Remove ${member.email}`}
                    >
                      <UserMinus aria-hidden="true" />
                      Remove
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
