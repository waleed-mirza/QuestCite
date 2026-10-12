import Link from "next/link";

import { AccessDenied } from "@/components/feedback/access-denied";
import { Card, CardContent } from "@/components/ui/card";
import { listAwaitingReview, listMyReviewQueue, type ReviewQueueItem } from "@/features/questionnaires/review-queue";
import { requireUser } from "@/server/auth/session";
import { guardOrgRoles } from "@/server/authorization/guard";

/**
 * Reviewer queue (plan §W6): everything across the workspace that needs a
 * review decision, in two passes — what is assigned to me, and everything
 * sitting in review. Rows link into the questionnaire workspace where the
 * approve/request-changes/reject actions live.
 */

const STATUS_BADGES: Record<string, string> = {
  in_review: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  changes_requested: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-400",
};

const STATUS_LABELS: Record<string, string> = {
  in_review: "In review",
  changes_requested: "Changes requested",
  rejected: "Rejected",
};

export default async function ReviewQueuePage({ params }: { params: Promise<{ orgSlug: string }> }) {
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

  const canReview = guard.ctx.role !== "viewer";
  const user = await requireUser();
  const [mine, awaiting] = await Promise.all([
    listMyReviewQueue(guard.ctx.organization.id, user.userId),
    canReview ? listAwaitingReview(guard.ctx.organization.id) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Questions that need a decision, across every questionnaire in this workspace.
        </p>
      </div>

      <QueueSection
        title="Assigned to me"
        description={
          canReview
            ? "Questions assigned to you that are in review, had changes requested, or were rejected."
            : "Viewers can watch progress here, but review actions belong to owners, admins, and reviewers."
        }
        items={mine}
        orgSlug={orgSlug}
        emptyMessage={
          canReview
            ? "Nothing is waiting on you. Questions you're assigned will show up here when they enter review."
            : undefined
        }
      />

      {canReview ? (
        <QueueSection
          title="Awaiting review"
          description="Every answer currently submitted for review in this workspace."
          items={awaiting}
          orgSlug={orgSlug}
          emptyMessage="No answers are waiting for review right now."
        />
      ) : null}
    </div>
  );
}

function QueueSection({
  title,
  description,
  items,
  orgSlug,
  emptyMessage,
}: {
  title: string;
  description: string;
  items: ReviewQueueItem[];
  orgSlug: string;
  emptyMessage: string | undefined;
}) {
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center">
            <p className="text-muted-foreground text-sm">{emptyMessage ?? "Nothing here right now."}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{title} — questions needing review</caption>
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th scope="col" className="px-3 py-2 font-medium">Question</th>
                <th scope="col" className="px-3 py-2 font-medium">Questionnaire</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.questionId} className="border-b">
                  <td className="max-w-md px-3 py-2">
                    <p className="truncate" title={item.questionText}>{item.questionText}</p>
                    <p className="text-muted-foreground text-xs">{item.category}</p>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/app/${orgSlug}/questionnaires/${item.questionnaireId}`}
                      className="hover:underline"
                    >
                      {item.questionnaireTitle}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGES[item.status] ?? STATUS_BADGES.in_review}`}>
                      {STATUS_LABELS[item.status] ?? item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
