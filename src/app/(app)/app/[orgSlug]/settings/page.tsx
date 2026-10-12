import { Settings } from "lucide-react";

import { AccessDenied } from "@/components/feedback/access-denied";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeletionControls } from "@/features/settings/components/deletion-controls";
import { WorkspaceSettingsForm } from "@/features/settings/components/settings-form";
import { getWorkspaceSettings } from "@/features/settings/server";
import { guardOrgRoles } from "@/server/authorization/guard";

export default async function SettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const guard = await guardOrgRoles(orgSlug, ["owner", "admin"]);
  if (!guard.ok) {
    if (guard.reason === "forbidden") return <AccessDenied what="workspace settings" />;
    return <Card><CardHeader><CardTitle>Workspace not found</CardTitle><CardDescription>We couldn&apos;t load this workspace.</CardDescription></CardHeader></Card>;
  }
  const settings = await getWorkspaceSettings(guard.ctx.organization.id);
  if (settings === null) {
    return <Card><CardHeader><CardTitle>Settings are temporarily unavailable</CardTitle><CardDescription>Try again shortly.</CardDescription></CardHeader></Card>;
  }
  const isOwner = guard.ctx.role === "owner";

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <div>
        <div className="flex items-center gap-2"><Settings aria-hidden="true" className="text-primary size-5" /><h1 className="text-2xl font-semibold tracking-tight">Workspace settings</h1></div>
        <p className="text-muted-foreground mt-1 text-sm">Control operational retention, AI drafting, metadata export, and workspace lifecycle.</p>
      </div>

      <Card><CardHeader><CardTitle>Controls</CardTitle><CardDescription>Changes are validated in the action and again by the database function.</CardDescription></CardHeader><CardContent><WorkspaceSettingsForm orgSlug={orgSlug} retentionDays={settings.retention_days} aiDraftsDisabled={settings.ai_drafts_disabled} /></CardContent></Card>

      <Card><CardHeader><CardTitle>Workspace metadata export</CardTitle><CardDescription>The JSON export contains workspace metadata and counts only; it does not contain document text, questionnaire questions, answers, prompts, or storage paths.</CardDescription></CardHeader><CardContent>{isOwner ? <a className="border-border inline-flex rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted" href={`/api/organizations/${encodeURIComponent(orgSlug)}/settings/export`}>Download metadata export</a> : <p className="text-muted-foreground text-sm">Metadata export is available to the workspace owner.</p>}</CardContent></Card>

      {isOwner ? <Card className="border-destructive/30"><CardHeader><CardTitle>Delete workspace</CardTitle><CardDescription>Deletion is a two-step owner-only workflow. Database rows are removed and stored files are cleaned up best-effort without exposing their paths.</CardDescription></CardHeader><CardContent><DeletionControls orgSlug={orgSlug} requestedAt={settings.deletion_requested_at} /></CardContent></Card> : null}
    </div>
  );
}
