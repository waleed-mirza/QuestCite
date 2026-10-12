import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionForm } from "@/features/trust-center/action-form";
import {
  deleteFaqAction,
  saveFaqAction,
} from "@/features/trust-center/actions";
import type { FaqRow } from "@/server/services/trust-center";

/** FAQ section editor — visible toggles are the public-visibility controls. */
export function FaqManager({ orgSlug, faqs }: { orgSlug: string; faqs: FaqRow[] }) {
  return (
    <div className="grid gap-4">
      <ul className="grid gap-3">
        {faqs.length === 0 ? (
          <li className="text-muted-foreground text-sm">No FAQs yet — add the first one below.</li>
        ) : null}
        {faqs.map((faq) => (
          <li key={faq.id} className="grid gap-2 rounded-md border p-3">
            <ActionForm
              orgSlug={orgSlug}
              action={saveFaqAction}
              submitLabel="Save"
              hidden={{ id: faq.id }}
              className="grid gap-2"
            >
              <div className="grid gap-1.5">
                <Label htmlFor={`faq-question-${faq.id}`}>Question</Label>
                <Input id={`faq-question-${faq.id}`} name="question" defaultValue={faq.question} required maxLength={300} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`faq-answer-${faq.id}`}>Answer</Label>
                <textarea
                  id={`faq-answer-${faq.id}`}
                  name="answer"
                  defaultValue={faq.answer}
                  required
                  maxLength={2000}
                  rows={3}
                  className="border-input bg-background min-h-16 rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="visible" defaultChecked={faq.visible} className="size-4" />
                Visible on the public page
              </label>
            </ActionForm>
            <ActionForm
              orgSlug={orgSlug}
              action={deleteFaqAction}
              submitLabel="Delete FAQ"
              hidden={{ id: faq.id }}
              variant="outline"
            />
          </li>
        ))}
      </ul>
      <div className="rounded-md border p-3">
        <h4 className="mb-2 text-sm font-medium">Add an FAQ</h4>
        <ActionForm orgSlug={orgSlug} action={saveFaqAction} submitLabel="Add FAQ" className="grid gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="faq-question-new">Question</Label>
            <Input id="faq-question-new" name="question" required maxLength={300} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="faq-answer-new">Answer</Label>
            <textarea
              id="faq-answer-new"
              name="answer"
              required
              maxLength={2000}
              rows={3}
              className="border-input bg-background min-h-16 rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="visible" defaultChecked className="size-4" />
            Visible on the public page
          </label>
        </ActionForm>
      </div>
    </div>
  );
}
