import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionForm } from "@/features/trust-center/action-form";
import {
  deleteSubprocessorAction,
  saveSubprocessorAction,
} from "@/features/trust-center/actions";
import type { SubprocessorRow } from "@/server/services/trust-center";

/** Subprocessors editor (company / purpose / data category / region). */
export function SubprocessorManager({
  orgSlug,
  subprocessors,
}: {
  orgSlug: string;
  subprocessors: SubprocessorRow[];
}) {
  return (
    <div className="grid gap-4">
      <ul className="grid gap-3">
        {subprocessors.length === 0 ? (
          <li className="text-muted-foreground text-sm">No subprocessors yet.</li>
        ) : null}
        {subprocessors.map((sub) => (
          <li key={sub.id} className="grid gap-2 rounded-md border p-3">
            <ActionForm
              orgSlug={orgSlug}
              action={saveSubprocessorAction}
              submitLabel="Save"
              hidden={{ id: sub.id }}
              className="grid gap-2 sm:grid-cols-2"
            >
              <div className="grid gap-1.5">
                <Label htmlFor={`sub-company-${sub.id}`}>Company</Label>
                <Input id={`sub-company-${sub.id}`} name="company" defaultValue={sub.company} required maxLength={160} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`sub-purpose-${sub.id}`}>Purpose</Label>
                <Input id={`sub-purpose-${sub.id}`} name="purpose" defaultValue={sub.purpose} required maxLength={300} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`sub-category-${sub.id}`}>Data category</Label>
                <Input id={`sub-category-${sub.id}`} name="dataCategory" defaultValue={sub.data_category} required maxLength={160} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`sub-region-${sub.id}`}>Region</Label>
                <Input id={`sub-region-${sub.id}`} name="region" defaultValue={sub.region} required maxLength={120} />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="publiclyVisible" defaultChecked={sub.publicly_visible} className="size-4" />
                Visible on the public page
              </label>
            </ActionForm>
            <ActionForm
              orgSlug={orgSlug}
              action={deleteSubprocessorAction}
              submitLabel="Delete subprocessor"
              hidden={{ id: sub.id }}
              variant="outline"
            />
          </li>
        ))}
      </ul>
      <div className="rounded-md border p-3">
        <h4 className="mb-2 text-sm font-medium">Add a subprocessor</h4>
        <ActionForm orgSlug={orgSlug} action={saveSubprocessorAction} submitLabel="Add subprocessor" className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="sub-company-new">Company</Label>
            <Input id="sub-company-new" name="company" required maxLength={160} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sub-purpose-new">Purpose</Label>
            <Input id="sub-purpose-new" name="purpose" required maxLength={300} placeholder="Managed database hosting" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sub-category-new">Data category</Label>
            <Input id="sub-category-new" name="dataCategory" required maxLength={160} placeholder="Customer content" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sub-region-new">Region</Label>
            <Input id="sub-region-new" name="region" required maxLength={120} placeholder="eu-central-1" />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="publiclyVisible" defaultChecked className="size-4" />
            Visible on the public page
          </label>
        </ActionForm>
      </div>
    </div>
  );
}
