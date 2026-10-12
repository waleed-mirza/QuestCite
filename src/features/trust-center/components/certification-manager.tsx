import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionForm } from "@/features/trust-center/action-form";
import {
  deleteCertificationAction,
  saveCertificationAction,
} from "@/features/trust-center/actions";
import type { CertificationRow } from "@/server/services/trust-center";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  expired: "Expired",
  planned: "Planned",
};

/** Certifications editor; `demo` marks fictional demo-tenant certs (plan §15). */
export function CertificationManager({
  orgSlug,
  certifications,
}: {
  orgSlug: string;
  certifications: CertificationRow[];
}) {
  return (
    <div className="grid gap-4">
      <ul className="grid gap-3">
        {certifications.length === 0 ? (
          <li className="text-muted-foreground text-sm">No certifications yet.</li>
        ) : null}
        {certifications.map((cert) => (
          <li key={cert.id} className="grid gap-2 rounded-md border p-3">
            <ActionForm
              orgSlug={orgSlug}
              action={saveCertificationAction}
              submitLabel="Save"
              hidden={{ id: cert.id }}
              className="grid gap-2 sm:grid-cols-2"
            >
              <div className="grid gap-1.5">
                <Label htmlFor={`cert-name-${cert.id}`}>Name</Label>
                <Input id={`cert-name-${cert.id}`} name="name" defaultValue={cert.name} required maxLength={120} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`cert-status-${cert.id}`}>Status</Label>
                <select
                  id={`cert-status-${cert.id}`}
                  name="status"
                  defaultValue={cert.status}
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`cert-issuer-${cert.id}`}>Issuer (optional)</Label>
                <Input id={`cert-issuer-${cert.id}`} name="issuer" defaultValue={cert.issuer ?? ""} maxLength={120} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`cert-from-${cert.id}`}>Valid from</Label>
                  <Input id={`cert-from-${cert.id}`} name="validFrom" type="date" defaultValue={cert.valid_from ?? ""} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`cert-until-${cert.id}`}>Valid until</Label>
                  <Input id={`cert-until-${cert.id}`} name="validUntil" type="date" defaultValue={cert.valid_until ?? ""} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="publiclyVisible" defaultChecked={cert.publicly_visible} className="size-4" />
                Visible on the public page
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="demo" defaultChecked={cert.demo} className="size-4" />
                Mark as demo
              </label>
            </ActionForm>
            <ActionForm
              orgSlug={orgSlug}
              action={deleteCertificationAction}
              submitLabel="Delete certification"
              hidden={{ id: cert.id }}
              variant="outline"
            />
          </li>
        ))}
      </ul>
      <div className="rounded-md border p-3">
        <h4 className="mb-2 text-sm font-medium">Add a certification</h4>
        <ActionForm orgSlug={orgSlug} action={saveCertificationAction} submitLabel="Add certification" className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cert-name-new">Name</Label>
            <Input id="cert-name-new" name="name" required maxLength={120} placeholder="SOC 2 Type II" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cert-status-new">Status</Label>
            <select id="cert-status-new" name="status" defaultValue="active" className="border-input bg-background h-9 rounded-md border px-3 text-sm">
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cert-issuer-new">Issuer (optional)</Label>
            <Input id="cert-issuer-new" name="issuer" maxLength={120} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="cert-from-new">Valid from</Label>
              <Input id="cert-from-new" name="validFrom" type="date" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cert-until-new">Valid until</Label>
              <Input id="cert-until-new" name="validUntil" type="date" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="publiclyVisible" defaultChecked className="size-4" />
            Visible on the public page
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="demo" className="size-4" />
            Mark as demo
          </label>
        </ActionForm>
      </div>
    </div>
  );
}
