"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_DOCUMENT_BYTES } from "@/config/ingestion";

/**
 * Upload + ingest form (plan §9). Posts multipart to the upload route handler
 * (Server Actions cap request bodies below the 10 MB document ceiling) and
 * surfaces every failure through its SAFE CODE so the operator learns what
 * happened without the system ever leaking paths or content.
 */

const CODE_COPY: Record<string, string> = {
  DOCUMENT_INPUT_INVALID: "Check the title and fields — something is missing or too long.",
  DOCUMENT_TYPE_UNSUPPORTED: "That file type isn't supported. Use PDF, DOCX, TXT, or Markdown.",
  DOCUMENT_TOO_LARGE: "Files are limited to 10 MB.",
  DOCUMENT_EMPTY: "That file is empty.",
  EXTENSION_MISMATCH: "The file's contents don't match its extension.",
  ENCODING_UNSUPPORTED: "Text files must be UTF-8.",
  FILENAME_INVALID: "Choose a simpler file name.",
  DOCUMENT_NOT_FOUND: "The target document no longer exists.",
  VERSION_LIMIT_REACHED: "This document has reached its version limit.",
  ORG_INACTIVE: "This workspace is deactivated.",
  FORBIDDEN: "You don't have permission to upload here.",
  STORAGE_UPLOAD_FAILED: "The file could not be stored. Please try again.",
  QUOTA_EXCEEDED: "This workspace has reached its plan limit. Upgrade or try again next period.",
  PROCESSING_FAILED: "The file uploaded, but processing failed. Open the document to retry.",
  AUTH_REQUIRED: "Your session expired — sign in again.",
  UPLOAD_FAILED: "Something went wrong. Please try again.",
};

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "ready"; documentId: string }
  | { kind: "error"; message: string };

export function UploadForm({ orgSlug, documentId }: { orgSlug: string; documentId?: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("file");
    if (!(fileInput instanceof HTMLInputElement) || fileInput.files === null || fileInput.files.length === 0) {
      setState({ kind: "error", message: "Choose a file to upload." });
      return;
    }
    const selected = fileInput.files[0];
    if (selected !== undefined && selected.size > MAX_DOCUMENT_BYTES) {
      setState({ kind: "error", message: CODE_COPY.DOCUMENT_TOO_LARGE ?? "Files are limited to 10 MB." });
      return;
    }

    setState({ kind: "uploading" });
    const body = new FormData(form);
    body.set("orgSlug", orgSlug);
    if (documentId !== undefined) {
      body.set("documentId", documentId);
    }

    try {
      const response = await fetch("/api/documents/upload", { method: "POST", body });
      const payload = (await response.json()) as { status?: string; code?: string; documentId?: string };
      if (!response.ok) {
        setState({ kind: "error", message: CODE_COPY[payload.code ?? ""] ?? CODE_COPY.UPLOAD_FAILED ?? "Something went wrong." });
        return;
      }
      if (payload.status === "processing_failed") {
        setState({ kind: "error", message: CODE_COPY.PROCESSING_FAILED ?? "Processing failed." });
        router.refresh();
        return;
      }
      setState({ kind: "ready", documentId: payload.documentId ?? "" });
      formRef.current?.reset();
      router.refresh();
    } catch {
      setState({ kind: "error", message: "The upload could not be sent. Check your connection and try again." });
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="grid gap-4" noValidate>
      {documentId === undefined ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="upload-title">Title</Label>
            <Input id="upload-title" name="title" placeholder="Access Control Policy" required maxLength={200} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="upload-category">Category</Label>
            <Input id="upload-category" name="category" placeholder="policies" maxLength={80} />
          </div>
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="upload-file">File (PDF, DOCX, TXT, MD — max 10 MB)</Label>
          <Input
            id="upload-file"
            name="file"
            type="file"
            required
            accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
          />
        </div>
        {documentId === undefined ? (
          <div className="grid gap-1.5">
            <Label htmlFor="upload-review">Review by (optional)</Label>
            <Input id="upload-review" name="reviewBy" type="date" />
          </div>
        ) : null}
      </div>

      {state.kind === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}
      {state.kind === "ready" ? (
        <p role="status" className="text-sm">
          Document uploaded and searchable.
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={state.kind === "uploading"}>
          <Upload aria-hidden="true" />
          {state.kind === "uploading" ? "Uploading…" : "Upload"}
        </Button>
      </div>
    </form>
  );
}
