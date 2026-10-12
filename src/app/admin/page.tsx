import { Activity, ShieldCheck } from "lucide-react";

import { AccessDenied } from "@/components/feedback/access-denied";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlatformAdmin } from "@/server/authorization/platform-admin";
import { getPlatformOrgHealth } from "@/server/services/platform-admin";

export default async function PlatformAdminPage() {
  const admin = await getPlatformAdmin();
  if (admin === null) return <AccessDenied what="platform administration" />;
  const organizations = await getPlatformOrgHealth();
  if (organizations === null) {
    return <Card><CardHeader><CardTitle>Platform health unavailable</CardTitle><CardDescription>Try again shortly.</CardDescription></CardHeader></Card>;
  }

  return (
    <main className="mx-auto grid min-h-svh w-full max-w-6xl content-start gap-6 p-6">
      <div>
        <div className="flex items-center gap-2"><ShieldCheck aria-hidden="true" className="text-primary size-5" /><h1 className="text-2xl font-semibold tracking-tight">Platform health</h1></div>
        <p className="text-muted-foreground mt-1 text-sm">Organization, subscription, and job health for authorized platform operators. Content is intentionally excluded.</p>
      </div>
      {organizations.length === 0 ? <Card><CardContent className="py-8 text-center"><p className="text-muted-foreground text-sm">No organizations yet.</p></CardContent></Card> : <div className="overflow-x-auto rounded-lg border"><table className="w-full border-collapse text-sm"><caption className="sr-only">Platform organization health</caption><thead><tr className="border-b bg-muted/40 text-left"><th scope="col" className="px-3 py-2">Organization</th><th scope="col" className="px-3 py-2">Plan</th><th scope="col" className="px-3 py-2">Subscription</th><th scope="col" className="px-3 py-2">Jobs</th><th scope="col" className="px-3 py-2">Updated</th></tr></thead><tbody>{organizations.map((organization) => <tr key={organization.organizationId} className="border-b"><td className="px-3 py-3"><p className="font-medium">{organization.organizationName}</p><p className="text-muted-foreground text-xs">{organization.slug}</p></td><td className="px-3 py-3 capitalize">{organization.planCode}</td><td className="px-3 py-3 capitalize">{organization.subscriptionStatus.replace("_", " ")}</td><td className="px-3 py-3"><span className="inline-flex items-center gap-1"><Activity aria-hidden="true" className="size-3" />{organization.jobs.running} running · {organization.jobs.failed} failed</span></td><td className="text-muted-foreground px-3 py-3">{new Date(organization.updatedAt).toLocaleDateString()}</td></tr>)}</tbody></table></div>}
    </main>
  );
}
