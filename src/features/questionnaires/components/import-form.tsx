"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_QUESTIONNAIRE_FILE_BYTES } from "@/config/questionnaires";
import { questionnaireCopyFor } from "@/features/questionnaires/copy";

/**
 * Questionnaire import form (plan §9 step 1). Posts multipart to the upload
 * route handler (Server Action bodies cap far below the 10 MB file ceiling)
 * and — unlike the document uploader — NAVIGATES to the mapping screen on
 * success: the import is not complete until the user confirms the column
 * mapping there. Every failure surfaces through its SAFE CODE.
 */

type ImportState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "error"; message: string };

export function ImportForm({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<ImportState>({ kind: "idle" });

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("file");
    if (!(fileInput instanceof HTMLInputElement) || fileInput.files === null || fileInput.files.length === 0) {
      setState({ kind: "error", message: "Choose a .xlsx or .csv file to import." });
      return;
    }
    const selected = fileInput.files[0];
    if (selected !== undefined && selected.size > MAX_QUESTIONNAIRE_FILE_BYTES) {
      setState({ kind: "error", message: questionnaireCopyFor("QUESTIONNAIRE_TOO_LARGE") });
      return;
    }

    setState({ kind: "uploading" });
    const body = new FormData(form);
    body.set("orgSlug", orgSlug);

    try {
      const response = await fetch("/api/questionnaires/upload", { method: "POST", body });
      const payload = (await response.json()) as { status?: string; code?: string; questionnaireId?: string };
      if (!response.ok || payload.status !== "ok" || payload.questionnaireId === undefined) {
        setState({ kind: "error", message: questionnaireCopyFor(payload.code) });
        return;
      }
      formRef.current?.reset();
      router.push(`/app/${orgSlug}/questionnaires/${payload.questionnaireId}/mapping`);
    } catch {
      setState({ kind: "error", message: "The upload could not be sent. Check your connection and try again." });
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="import-title">Title</Label>
          <Input id="import-title" name="title" placeholder="Acme security questionnaire" required maxLength={200} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="import-customer">Customer (optional)</Label>
          <Input id="import-customer" name="customer" placeholder="Acme Corp" maxLength={200} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="import-due">Due date (optional)</Label>
          <Input id="import-due" name="dueDate" type="date" />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="import-file">File (.xlsx or .csv — max 10 MB)</Label>
        <Input
          id="import-file"
          name="file"
          type="file"
          required
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        />
        <p className="text-muted-foreground text-xs">
          The original file is stored unchanged; you&apos;ll confirm which columns hold questions and answers on
          the next screen before anything is imported.
        </p>
      </div>

      {state.kind === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={state.kind === "uploading"}>
          <FileSpreadsheet aria-hidden="true" />
          {state.kind === "uploading" ? "Uploading…" : "Continue to mapping"}
        </Button>
      </div>
    </form>
  );
}
