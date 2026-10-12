import { describe, expect, it } from "vitest";

import {
  summarizeByAssignee,
  summarizeByCategory,
  summarizeByStatus,
  type DashboardRow,
} from "@/features/questionnaires/dashboard";
import { countQuestionnaireProgress, isQuestionResolved } from "@/features/questionnaires/progress";

/**
 * Progress dashboards (plan §W6): pure breakdowns by state, category, and
 * reviewer over the same resolved semantics as the W4 progress counter
 * (D023 — resolved = a deliberate decision or a conscious blank).
 */

function row(overrides: Partial<DashboardRow>): DashboardRow {
  return {
    status: "answered",
    blank_by_choice: false,
    category: "general",
    assignee_id: null,
    ...overrides,
  };
}

describe("summarizeByStatus", () => {
  it("counts per status in workflow order, dropping empty slices", () => {
    const slices = summarizeByStatus([
      row({ status: "approved" }),
      row({ status: "empty" }),
      row({ status: "approved" }),
      row({ status: "drafted" }),
      row({ status: "in_review" }),
    ]);
    expect(slices).toEqual([
      { status: "empty", count: 1 },
      { status: "drafted", count: 1 },
      { status: "in_review", count: 1 },
      { status: "approved", count: 2 },
    ]);
  });

  it("never emits zero-count slices", () => {
    const slices = summarizeByStatus([row({ status: "answered" })]);
    expect(slices.map((slice) => slice.status)).not.toContain("rejected");
  });
});

describe("summarizeByCategory", () => {
  it("aggregates totals, resolved, and approved per category, biggest first", () => {
    const slices = summarizeByCategory([
      row({ category: "encryption", status: "approved" }),
      row({ category: "encryption", status: "empty" }),
      row({ category: "hosting", status: "answered" }),
      row({ category: "encryption", status: "in_review" }),
      row({ category: "hosting", blank_by_choice: true, status: "empty" }),
    ]);
    expect(slices).toEqual([
      { category: "encryption", total: 3, resolved: 2, approved: 1 },
      { category: "hosting", total: 2, resolved: 2, approved: 0 },
    ]);
  });

  it("a conscious blank counts as resolved within its category", () => {
    const slices = summarizeByCategory([row({ category: "legal", blank_by_choice: true, status: "empty" })]);
    expect(slices[0]).toMatchObject({ resolved: 1, approved: 0 });
  });
});

describe("summarizeByAssignee", () => {
  it("groups by assignee with unassigned as its own slice, busiest first", () => {
    const slices = summarizeByAssignee([
      row({ assignee_id: "user-1", status: "approved" }),
      row({ assignee_id: "user-2", status: "answered" }),
      row({ assignee_id: "user-1", status: "drafted" }),
      row({ status: "empty" }),
    ]);
    expect(slices).toEqual([
      { assigneeId: "user-1", total: 2, resolved: 1, approved: 1 },
      { assigneeId: "user-2", total: 1, resolved: 1, approved: 0 },
      { assigneeId: null, total: 1, resolved: 0, approved: 0 },
    ]);
  });
});

describe("resolved semantics stay shared with the W4 counter", () => {
  it("isQuestionResolved agrees with countQuestionnaireProgress", () => {
    const rows = [
      row({ status: "approved" }),
      row({ status: "drafted" }),
      row({ blank_by_choice: true, status: "empty" }),
      row({ status: "insufficient_evidence" }),
    ];
    const manual = rows.filter(isQuestionResolved).length;
    expect(countQuestionnaireProgress(rows)).toEqual({ resolved: manual, total: rows.length });
    expect(manual).toBe(3);
  });
});
