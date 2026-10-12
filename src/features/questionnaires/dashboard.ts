import type { Database } from "@/types/database.types";
import { isQuestionResolved, type QuestionProgressRow } from "@/features/questionnaires/progress";

/**
 * Progress dashboards (plan §W6): by state, by category, by reviewer.
 *
 * Pure aggregation over the question list — the read model (server.ts) only
 * fetches the four columns these need. Every slice carries its counts in
 * plain numbers; the UI renders single-hue share bars with the text as the
 * accessible channel (same spec as the header progress meter).
 */

type AnswerStatus = Database["public"]["Enums"]["answer_status"];

export type DashboardRow = QuestionProgressRow & {
  category: string;
  assignee_id: string | null;
};

/** Workflow order (PRD §7.2) — slices render in this order, never alphabetically. */
const STATUS_ORDER: readonly AnswerStatus[] = [
  "empty",
  "generating",
  "drafted",
  "answered",
  "insufficient_evidence",
  "in_review",
  "changes_requested",
  "rejected",
  "approved",
];

export type StatusSlice = {
  status: AnswerStatus;
  count: number;
};

export function summarizeByStatus(rows: DashboardRow[]): StatusSlice[] {
  const counts = new Map<AnswerStatus, number>();
  for (const row of rows) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }
  return STATUS_ORDER.filter((status) => (counts.get(status) ?? 0) > 0).map((status) => ({
    status,
    count: counts.get(status) ?? 0,
  }));
}

export type CategorySlice = {
  category: string;
  total: number;
  resolved: number;
  approved: number;
};

export function summarizeByCategory(rows: DashboardRow[]): CategorySlice[] {
  const byCategory = new Map<string, CategorySlice>();
  for (const row of rows) {
    const slice = byCategory.get(row.category) ?? { category: row.category, total: 0, resolved: 0, approved: 0 };
    slice.total += 1;
    if (isQuestionResolved(row)) {
      slice.resolved += 1;
    }
    if (row.status === "approved") {
      slice.approved += 1;
    }
    byCategory.set(row.category, slice);
  }
  return [...byCategory.values()].sort(
    (a, b) => b.total - a.total || a.category.localeCompare(b.category),
  );
}

export type AssigneeSlice = {
  assigneeId: string | null;
  total: number;
  resolved: number;
  approved: number;
};

export function summarizeByAssignee(rows: DashboardRow[]): AssigneeSlice[] {
  const byAssignee = new Map<string, AssigneeSlice>();
  for (const row of rows) {
    const key = row.assignee_id ?? "";
    const slice = byAssignee.get(key) ?? {
      assigneeId: row.assignee_id,
      total: 0,
      resolved: 0,
      approved: 0,
    };
    slice.total += 1;
    if (isQuestionResolved(row)) {
      slice.resolved += 1;
    }
    if (row.status === "approved") {
      slice.approved += 1;
    }
    byAssignee.set(key, slice);
  }
  return [...byAssignee.values()].sort((a, b) => b.total - a.total);
}
