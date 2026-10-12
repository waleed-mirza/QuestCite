import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function BillingLoading() {
  return <Card className="mx-auto max-w-5xl"><CardHeader><div className="bg-muted h-6 w-40 animate-pulse rounded" /></CardHeader><CardContent><div className="bg-muted h-24 animate-pulse rounded" /></CardContent></Card>;
}
