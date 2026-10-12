import Link from "next/link";
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";

import { AccessDenied } from "@/components/feedback/access-denied";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MappingPreview } from "@/features/questionnaires/components/mapping-preview";
import { getMappingPreview } from "@/features/questionnaires/server";
import { guardOrgRoles } from "@/server/authorization/guard";

/**
 * Mapping preview (plan §9 step 4). The original file is re-read from
 * storage and re-inspected HERE — the user confirms the mapping against the
 * stored bytes, never against client-claimed content. Reached only for
 * questionnaires still in importing/mapping state; anything else redirects
 * to the questionnaire itself.
 */

export default async function MappingPage({
  params,
}: {
  params: Promise<{ orgSlug: string; questionnaireId: string }>;
}) {
  const { orgSlug, questionnaireId } = await params;

  const guard = await guardOrgRoles(orgSlug, ["owner", "admin", "reviewer"]);
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") {
      return null;
    }
    if (guard.reason === "forbidden") {
      return <AccessDenied what="this workspace" />;
    }
    notFound();
  }

  const preview = await getMappingPreview(guard.ctx.organization.id, questionnaireId);
  if (preview === null) {
    notFound();
  }
  if (preview === "STORAGE_UNAVAILABLE") {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlert aria-hidden="true" className="text-destructive size-5" />
              The original file could not be read
            </CardTitle>
            <CardDescription>
              The stored workbook failed to open. Delete this questionnaire from the library and import the
              file again.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const { detail, inspection } = preview;
  const status = detail.questionnaire.status;
  if (status !== "importing" && status !== "mapping") {
    // Already live (or beyond) — the mapping decision was made.
    return <MappingDoneRedirect orgSlug={orgSlug} questionnaireId={questionnaireId} />;
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6">
      <div>
        <Link href={`/app/${orgSlug}/questionnaires`} className="text-muted-foreground text-sm hover:underline">
          ← All questionnaires
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Map the columns</h1>
        <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
          Tell QuestCite which column holds the questions (and optionally the answer/notes columns). The
          preselected columns are a suggestion — check them, change anything that&apos;s wrong, then confirm.
          <span className="font-medium"> Nothing is imported until you confirm.</span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{detail.questionnaire.title}</CardTitle>
          <CardDescription>
            {detail.file?.format.toUpperCase() ?? "Workbook"} · parsed with {preview.parserVersion}
            {detail.questionnaire.customer !== "" ? ` · ${detail.questionnaire.customer}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MappingPreview orgSlug={orgSlug} questionnaireId={questionnaireId} inspection={inspection} />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Client-free hand-off for already-confirmed questionnaires. Rendered as a
 * link card (a redirect() from a render body would also work, but the link
 * explains WHY the user landed here — friendlier after a stale tab).
 */
function MappingDoneRedirect({ orgSlug, questionnaireId }: { orgSlug: string; questionnaireId: string }) {
  return (
    <Card className="mx-auto mt-16 max-w-md">
      <CardHeader>
        <CardTitle>Mapping already confirmed</CardTitle>
        <CardDescription>
          This questionnaire is live. Open it to work through the questions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href={`/app/${orgSlug}/questionnaires/${questionnaireId}`} className="text-primary text-sm underline">
          Open the questionnaire →
        </Link>
      </CardContent>
    </Card>
  );
}
