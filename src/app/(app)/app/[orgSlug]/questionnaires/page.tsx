import Link from "next/link";
import { FileSpreadsheet, Trash2 } from "lucide-react";

import { AccessDenied } from "@/components/feedback/access-denied";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ImportForm } from "@/features/questionnaires/components/import-form";
import { deleteQuestionnaireAction } from "@/features/questionnaires/actions";
import { listQuestionnaires } from "@/features/questionnaires/server";
import { guardOrgRoles } from "@/server/authorization/guard";

/**
 * Questionnaires (plan §W4, PRD §7.1): the org's imported customer
 * questionnaires with their lifecycle status. Owner/admin/reviewer import;
 * viewers read. Deletion (owner/admin) removes the questionnaire and its
 * original file — it is also the recovery path for an interrupted import.
 */

// Muted text on bg-muted must clear WCAG AA at 12px (text-muted-foreground
// is 4.34:1) — neutral-700/300 keeps the muted look with ~9:1 contrast.
const MUTED_BADGE = "bg-muted text-neutral-700 dark:text-neutral-300";

const STATUS_STYLES: Record<string, string> = {
  importing: MUTED_BADGE,
  mapping: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  in_review: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  exported: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  archived: MUTED_BADGE,
};

export default async function QuestionnairesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const guard = await guardOrgRoles(orgSlug, ["owner", "admin", "reviewer", "viewer"]);
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return null;
    }
    if (guard.reason === "forbidden") {
      return <AccessDenied what="this workspace" />;
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>Workspace not found</CardTitle>
          <CardDescription>You may not be a member of this workspace.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const questionnaires = await listQuestionnaires(guard.ctx.organization.id);
  const canImport = guard.ctx.role === "owner" || guard.ctx.role === "admin" || guard.ctx.role === "reviewer";
  const canDelete = guard.ctx.role === "owner" || guard.ctx.role === "admin";

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Questionnaires</h1>
        <p className="text-muted-foreground mt-1">
          Customer security questionnaires imported into {guard.ctx.organization.name} — answer, review, and
          export them without leaving the workspace.
        </p>
      </div>

      {canImport ? (
        <Card>
          <CardHeader>
            <CardTitle>Import a questionnaire</CardTitle>
            <CardDescription>
              Upload the .xlsx or .csv your customer sent. You&apos;ll map the columns and confirm before any
              question is created.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ImportForm orgSlug={orgSlug} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Library</CardTitle>
          <CardDescription>
            {questionnaires.length === 0
              ? "No questionnaires yet."
              : `${questionnaires.length} questionnaire${questionnaires.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {questionnaires.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-sm">
              <FileSpreadsheet aria-hidden="true" className="size-8" />
              {canImport ? (
                <p>Import your first customer questionnaire to get started.</p>
              ) : (
                <p>No questionnaires yet — owners, admins, and reviewers can import them.</p>
              )}
            </div>
          ) : (
            <ul className="divide-border/60 divide-y">
              {questionnaires.map((questionnaire) => {
                const href = `/app/${orgSlug}/questionnaires/${questionnaire.id}`;
                const stuck = questionnaire.status === "importing";
                return (
                  <li key={questionnaire.id} className="py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <Link href={href} className="group min-w-0 flex-1">
                        <p className="truncate text-sm font-medium group-hover:underline">
                          {questionnaire.title}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {questionnaire.customer !== "" ? `${questionnaire.customer} · ` : ""}
                          {`${questionnaire.questionCount} question${questionnaire.questionCount === 1 ? "" : "s"}`}
                          {questionnaire.due_date !== null
                            ? ` · due ${new Date(`${questionnaire.due_date}T00:00:00`).toLocaleDateString()}`
                            : ""}
                          {` · updated ${new Date(questionnaire.updated_at).toLocaleDateString()}`}
                        </p>
                      </Link>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[questionnaire.status] ?? STATUS_STYLES.importing}`}
                        >
                          {questionnaire.status}
                        </span>
                        {canDelete ? (
                          <form action={deleteQuestionnaireAction.bind(null, orgSlug)}>
                            <input type="hidden" name="questionnaireId" value={questionnaire.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${questionnaire.title}`}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 aria-hidden="true" className="size-4" />
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                    {stuck ? (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        Import not finished — open it to continue mapping, or delete it and re-import.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
