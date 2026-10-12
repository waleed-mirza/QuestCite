import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function SettingsLoading() {
  return <Card className="mx-auto max-w-4xl"><CardHeader><div className="bg-muted h-6 w-48 animate-pulse rounded" /></CardHeader><CardContent><div className="bg-muted h-32 animate-pulse rounded" /></CardContent></Card>;
}
