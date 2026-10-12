import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/server/authorization/org";
import type { Database } from "@/types/database.types";

/**
 * Internal (member-side) Trust Center service (plan §W7). All reads go
 * through the caller's own client so RLS is the enforcement layer; the
 * editor pages additionally require owner/admin via requireOrgRole.
 *
 * The editor deliberately shows MORE than the public page (draft content,
 * hidden items, archived documents) — that is its purpose — but everything it
 * renders stays org-scoped by RLS.
 */

export type TrustCenterRow = Database["public"]["Tables"]["trust_centers"]["Row"];
export type FaqRow = Database["public"]["Tables"]["trust_center_faqs"]["Row"];
export type CertificationRow = Database["public"]["Tables"]["certifications"]["Row"];
export type SubprocessorRow = Database["public"]["Tables"]["subprocessors"]["Row"];
type TrustDocumentRow = Database["public"]["Tables"]["trust_center_documents"]["Row"];
type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
type AccessRequestRow = Database["public"]["Tables"]["access_requests"]["Row"];
type GrantRow = Database["public"]["Tables"]["document_access_grants"]["Row"];

export type EditorTrustDocument = {
  id: string;
  documentId: string;
  title: string;
  description: string;
  publiclyRequestable: boolean;
  documentState: Database["public"]["Enums"]["document_state"];
  /** A card is only publicly effective with a live doc AND a ready version. */
  hasReadyVersion: boolean;
};

export type PickerDocument = {
  id: string;
  title: string;
  category: string;
  state: Database["public"]["Enums"]["document_state"];
  hasReadyVersion: boolean;
  alreadyListed: boolean;
};

export type TrustCenterEditorState = {
  organizationId: string;
  trustCenter: TrustCenterRow;
  faqs: FaqRow[];
  certifications: CertificationRow[];
  subprocessors: SubprocessorRow[];
  trustDocuments: EditorTrustDocument[];
  pickerDocuments: PickerDocument[];
};

/** Documents that have at least one `ready` version (ready-version map). */
async function readyVersionDocumentIds(
  supabase: SupabaseClient<Database>,
  documentIds: string[],
): Promise<Set<string>> {
  if (documentIds.length === 0) {
    return new Set();
  }
  const { data, error } = await supabase
    .from("document_versions")
    .select("document_id")
    .in("document_id", documentIds)
    .eq("processing_state", "ready");
  if (error !== null) {
    throw new Error("TRUST_EDITOR_LOAD_FAILED");
  }
  return new Set((data ?? []).map((row) => row.document_id as string));
}

export async function getTrustCenterEditorState(orgSlug: string): Promise<TrustCenterEditorState> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const supabase = await createSupabaseServerClient();
  const organizationId = ctx.organization.id;

  const [tcResult, faqResult, certResult, subResult, tcdResult, docResult] = await Promise.all([
    supabase.from("trust_centers").select("*").eq("organization_id", organizationId).maybeSingle(),
    supabase
      .from("trust_center_faqs")
      .select("*")
      .eq("organization_id", organizationId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("certifications")
      .select("*")
      .eq("organization_id", organizationId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("subprocessors")
      .select("*")
      .eq("organization_id", organizationId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("trust_center_documents")
      .select("*")
      .eq("organization_id", organizationId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("documents")
      .select("id, title, category, state")
      .eq("organization_id", organizationId)
      .order("title", { ascending: true }),
  ]);

  if (tcResult.error !== null || tcResult.data === null) {
    throw new Error("TRUST_EDITOR_LOAD_FAILED");
  }
  if (
    faqResult.error !== null ||
    certResult.error !== null ||
    subResult.error !== null ||
    tcdResult.error !== null ||
    docResult.error !== null
  ) {
    throw new Error("TRUST_EDITOR_LOAD_FAILED");
  }

  const documents = (docResult.data ?? []) as Array<
    Pick<DocumentRow, "id" | "title" | "category" | "state">
  >;
  const readyIds = await readyVersionDocumentIds(supabase, documents.map((d) => d.id));
  const listedByDocumentId = new Map<string, TrustDocumentRow>();
  for (const row of (tcdResult.data ?? []) as TrustDocumentRow[]) {
    listedByDocumentId.set(row.document_id, row);
  }
  const titleById = new Map(documents.map((d) => [d.id, d] as const));

  const trustDocuments: EditorTrustDocument[] = ((tcdResult.data ?? []) as TrustDocumentRow[])
    .filter((row) => titleById.has(row.document_id))
    .map((row) => ({
      id: row.id,
      documentId: row.document_id,
      title: titleById.get(row.document_id)?.title ?? "",
      description: row.description,
      publiclyRequestable: row.publicly_requestable,
      documentState: titleById.get(row.document_id)?.state ?? "active",
      hasReadyVersion: readyIds.has(row.document_id),
    }));

  const pickerDocuments: PickerDocument[] = documents.map((doc) => ({
    id: doc.id,
    title: doc.title,
    category: doc.category,
    state: doc.state,
    hasReadyVersion: readyIds.has(doc.id),
    alreadyListed: listedByDocumentId.has(doc.id),
  }));

  return {
    organizationId,
    trustCenter: tcResult.data,
    faqs: (faqResult.data ?? []) as FaqRow[],
    certifications: (certResult.data ?? []) as CertificationRow[],
    subprocessors: (subResult.data ?? []) as SubprocessorRow[],
    trustDocuments,
    pickerDocuments,
  };
}

// ---------------------------------------------------------------------------
// Access request queue (J9)
// ---------------------------------------------------------------------------

export type QueueGrant = {
  grantId: string;
  documentId: string;
  documentTitle: string;
  state: Database["public"]["Enums"]["access_grant_state"];
  expiresAt: string;
};

export type QueueRequest = {
  id: string;
  prospectName: string;
  prospectCompany: string;
  prospectEmail: string;
  state: Database["public"]["Enums"]["access_request_state"];
  requestedDocumentIds: string[];
  requestExpiresAt: string;
  createdAt: string;
  acceptedTermsVersion: string | null;
  grants: QueueGrant[];
  downloadCount: number;
};

export type TrustDocumentTitleMap = Map<string, string>;

/** documentId → title, for rendering requested ids as names. */
export async function trustDocumentTitles(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<TrustDocumentTitleMap> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, title")
    .eq("organization_id", organizationId);
  if (error !== null) {
    throw new Error("TRUST_QUEUE_LOAD_FAILED");
  }
  return new Map(((data ?? []) as Array<Pick<DocumentRow, "id" | "title">>).map((d) => [d.id, d.title]));
}

export async function getAccessRequestQueue(orgSlug: string): Promise<QueueRequest[]> {
  const ctx = await requireOrgRole(["owner", "admin"], orgSlug);
  const supabase = await createSupabaseServerClient();
  const organizationId = ctx.organization.id;

  const [requestResult, grantResult, ndaResult, downloadResult, titles] = await Promise.all([
    supabase
      .from("access_requests")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("document_access_grants")
      .select("id, access_request_id, document_id, state, expires_at")
      .eq("organization_id", organizationId),
    supabase
      .from("nda_acceptances")
      .select("access_request_id, terms_version, accepted_at")
      .eq("organization_id", organizationId)
      .order("accepted_at", { ascending: true }),
    supabase
      .from("download_events")
      .select("access_request_id")
      .eq("organization_id", organizationId),
    trustDocumentTitles(supabase, organizationId),
  ]);

  if (
    requestResult.error !== null ||
    grantResult.error !== null ||
    ndaResult.error !== null ||
    downloadResult.error !== null
  ) {
    throw new Error("TRUST_QUEUE_LOAD_FAILED");
  }

  const grantsByRequest = new Map<string, GrantRow[]>();
  for (const grant of (grantResult.data ?? []) as GrantRow[]) {
    const list = grantsByRequest.get(grant.access_request_id) ?? [];
    list.push(grant);
    grantsByRequest.set(grant.access_request_id, list);
  }

  const termsByRequest = new Map<string, string>();
  for (const nda of (ndaResult.data ?? []) as Array<{
    access_request_id: string;
    terms_version: string;
  }>) {
    termsByRequest.set(nda.access_request_id, nda.terms_version);
  }

  const downloadsByRequest = new Map<string, number>();
  for (const event of (downloadResult.data ?? []) as Array<{ access_request_id: string }>) {
    downloadsByRequest.set(event.access_request_id, (downloadsByRequest.get(event.access_request_id) ?? 0) + 1);
  }

  return ((requestResult.data ?? []) as AccessRequestRow[]).map((request) => ({
    id: request.id,
    prospectName: request.prospect_name,
    prospectCompany: request.prospect_company,
    prospectEmail: request.prospect_email,
    state: request.state,
    requestedDocumentIds: [...request.requested_document_ids],
    requestExpiresAt: request.request_expires_at,
    createdAt: request.created_at,
    acceptedTermsVersion: termsByRequest.get(request.id) ?? null,
    grants: (grantsByRequest.get(request.id) ?? []).map((grant) => ({
      grantId: grant.id,
      documentId: grant.document_id,
      documentTitle: titles.get(grant.document_id) ?? "Removed document",
      state: grant.state,
      expiresAt: grant.expires_at,
    })),
    downloadCount: downloadsByRequest.get(request.id) ?? 0,
  }));
}
