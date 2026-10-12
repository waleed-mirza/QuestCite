import Link from "next/link";

import { AccessDenied } from "@/components/feedback/access-denied";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/features/notifications/actions";
import { notificationCopyFor } from "@/features/notifications/copy";
import { listMyNotifications } from "@/features/notifications/server";
import { requireUser } from "@/server/auth/session";
import { guardOrgRoles } from "@/server/authorization/guard";

/**
 * In-app notifications (plan §W6): the caller's own feed, newest first, with
 * per-row and bulk mark-read. Every row links into the questionnaire it
 * belongs to; read state is a column-scoped update on the caller's own rows
 * (RLS, migration 0020).
 */

export default async function NotificationsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const guard = await guardOrgRoles(orgSlug, ["owner", "admin", "reviewer", "viewer"]);
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return null;
    }
    if (guard.reason === "forbidden") {
      return <AccessDenied what="this workspace" />;
    }
    return null;
  }

  const user = await requireUser();
  const notifications = await listMyNotifications(guard.ctx.organization.id, user.userId);
  const unread = notifications.filter((row) => row.readAt === null).length;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground mt-1 text-sm" aria-live="polite">
            {unread === 0 ? "You're all caught up." : `${unread} unread`}
          </p>
        </div>
        {unread > 0 ? (
          <form action={markAllNotificationsReadAction.bind(null, orgSlug)}>
            <Button type="submit" variant="outline" size="sm">
              Mark all read
            </Button>
          </form>
        ) : null}
      </div>

      {notifications.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground text-sm">
              Nothing here yet. Assignments, review activity, comments, and exports in this workspace will show up
              here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-2">
          {notifications.map((row) => (
            <li
              key={row.id}
              className={`rounded-lg border p-3 ${row.readAt === null ? "border-blue-500/40 bg-blue-500/5" : "border-border/60"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  {row.readAt === null ? (
                    <span className="mr-2 inline-block size-2 rounded-full bg-blue-600" aria-hidden="true" />
                  ) : null}
                  <span className={row.readAt === null ? "font-medium" : "text-muted-foreground"}>
                    {notificationCopyFor(row.type)}
                  </span>
                  {row.questionnaireTitle !== null ? (
                    <span className="text-muted-foreground"> · {row.questionnaireTitle}</span>
                  ) : null}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    {new Date(row.createdAt).toLocaleString()}
                  </span>
                  {row.readAt === null ? (
                    <form action={markNotificationReadAction.bind(null, orgSlug)}>
                      <input type="hidden" name="notificationId" value={row.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Mark read
                      </Button>
                    </form>
                  ) : null}
                </div>
              </div>
              {row.questionnaireId !== null ? (
                <Link
                  href={`/app/${orgSlug}/questionnaires/${row.questionnaireId}`}
                  className="text-primary mt-1 inline-block text-xs underline"
                >
                  Open questionnaire →
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
