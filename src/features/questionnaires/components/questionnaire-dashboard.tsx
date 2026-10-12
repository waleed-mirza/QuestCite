import { Card, CardContent } from "@/components/ui/card";
import { STATUS_LABELS } from "@/features/questionnaires/constants";
import type { QuestionnaireDashboard } from "@/features/questionnaires/server";

/**
 * Progress dashboards (plan §W6): breakdowns by state, category, and
 * reviewer. Tables carry the numbers (the accessible channel); each row's
 * share bar is a decorative single-hue meter over a lighter step of the same
 * ramp (dataviz spec: sequential job, thin mark, text never wears the hue,
 * value/state never rides on color alone).
 */

export function QuestionnaireDashboard({ dashboard }: { dashboard: QuestionnaireDashboard }) {
  return (
    <Card>
      <CardContent className="grid gap-6 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Progress breakdown</h2>
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="grid gap-2">
            <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">By state</h3>
            {dashboard.byStatus.length === 0 ? (
              <p className="text-muted-foreground text-xs">No questions yet.</p>
            ) : (
              <ul className="grid gap-2">
                {dashboard.byStatus.map((slice) => (
                  <li key={slice.status} className="grid gap-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span>{statusLabel(slice.status)}</span>
                      <span className="text-muted-foreground tabular-nums">{slice.count}</span>
                    </div>
                    <ShareBar value={slice.count} total={dashboard.byStatus.reduce((sum, s) => sum + s.count, 0)} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-2">
            <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">By category</h3>
            {dashboard.byCategory.length === 0 ? (
              <p className="text-muted-foreground text-xs">No questions yet.</p>
            ) : (
              <ul className="grid gap-2">
                {dashboard.byCategory.map((slice) => (
                  <li key={slice.category} className="grid gap-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate" title={slice.category}>{slice.category}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {slice.resolved}/{slice.total}
                      </span>
                    </div>
                    <ShareBar value={slice.resolved} total={slice.total} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-2">
            <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">By reviewer</h3>
            {dashboard.byAssignee.length === 0 ? (
              <p className="text-muted-foreground text-xs">No questions yet.</p>
            ) : (
              <ul className="grid gap-2">
                {dashboard.byAssignee.map((slice) => (
                  <li key={slice.assigneeId ?? "unassigned"} className="grid gap-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{slice.assigneeName ?? "Unassigned"}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {slice.resolved}/{slice.total}
                      </span>
                    </div>
                    <ShareBar value={slice.resolved} total={slice.total} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  );
}

/** Single-hue share meter (decorative — the count text is the channel). */
function ShareBar({ value, total }: { value: number; total: number }) {
  const percent = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div aria-hidden="true" className="bg-blue-500/15 h-2 overflow-hidden rounded-full">
      <div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
    </div>
  );
}

function statusLabel(status: string): string {
  // Falls back to the raw enum for any future status the copy map lacks.
  return (
    STATUS_LABELS[status] ??
    status.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}
