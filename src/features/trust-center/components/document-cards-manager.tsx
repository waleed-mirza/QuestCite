import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionForm } from "@/features/trust-center/action-form";
import {
  deleteTrustDocumentAction,
  saveTrustDocumentAction,
} from "@/features/trust-center/actions";
import type { EditorTrustDocument, PickerDocument } from "@/server/services/trust-center";

function ineffectiveReason(card: EditorTrustDocument): string {
  if (card.documentState !== "active") {
    return "the document is archived.";
  }
  if (!card.hasReadyVersion) {
    return "the document has no processed (ready) version.";
  }
  return "requestability is off.";
}

/**
 * Requestable document cards. The "publicly requestable" flag alone is not
 * enough — the row only renders publicly when the document is active AND has
 * a ready version; that combination is surfaced here so the admin is never
 * surprised by a hidden card.
 */
export function DocumentCardsManager({
  orgSlug,
  trustDocuments,
  pickerDocuments,
}: {
  orgSlug: string;
  trustDocuments: EditorTrustDocument[];
  pickerDocuments: PickerDocument[];
}) {
  const addable = pickerDocuments.filter((doc) => !doc.alreadyListed);

  return (
    <div className="grid gap-4">
      <ul className="grid gap-3">
        {trustDocuments.length === 0 ? (
          <li className="text-muted-foreground text-sm">No document cards yet.</li>
        ) : null}
        {trustDocuments.map((card) => {
          const effective = card.publiclyRequestable && card.documentState === "active" && card.hasReadyVersion;
          return (
            <li key={card.id} className="grid gap-2 rounded-md border p-3">
              {!effective ? (
                <p className="text-destructive text-sm" role="note">
                  Not publicly effective:{" "}
                  {ineffectiveReason(card)}
                </p>
              ) : null}
              <ActionForm
                orgSlug={orgSlug}
                action={saveTrustDocumentAction}
                submitLabel="Save"
                hidden={{ id: card.id, documentId: card.documentId }}
                className="grid gap-2"
              >
                <div className="grid gap-1.5">
                  <Label htmlFor={`tcd-desc-${card.id}`}>Card description for “{card.title}”</Label>
                  <Input id={`tcd-desc-${card.id}`} name="description" defaultValue={card.description} required maxLength={500} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="publiclyRequestable"
                    defaultChecked={card.publiclyRequestable}
                    className="size-4"
                  />
                  Publicly requestable
                </label>
              </ActionForm>
              <ActionForm
                orgSlug={orgSlug}
                action={deleteTrustDocumentAction}
                submitLabel="Remove card"
                hidden={{ id: card.id }}
                variant="outline"
              />
            </li>
          );
        })}
      </ul>
      <div className="rounded-md border p-3">
        <h4 className="mb-2 text-sm font-medium">Add a document card</h4>
        <ActionForm
          orgSlug={orgSlug}
          action={saveTrustDocumentAction}
          submitLabel="Add card"
          disabled={addable.length === 0}
          className="grid gap-2"
        >
          {addable.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Every document already has a card. Upload or process more documents first.
            </p>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="tcd-document-new">Document</Label>
              <select id="tcd-document-new" name="documentId" required className="border-input bg-background h-9 rounded-md border px-3 text-sm">
                {addable.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.title}
                    {doc.state === "archived" ? " (archived)" : ""}
                    {!doc.hasReadyVersion ? " (no ready version)" : ""}
                </option>
              ))}
            </select>
            </div>
          )}
          {addable.length > 0 ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="tcd-desc-new">Description shown on the public card</Label>
                <Input id="tcd-desc-new" name="description" required maxLength={500} placeholder="High-level security overview (PDF)" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="publiclyRequestable" defaultChecked className="size-4" />
                Publicly requestable
              </label>
            </>
          ) : null}
        </ActionForm>
      </div>
    </div>
  );
}
