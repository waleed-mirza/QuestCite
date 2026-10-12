import { describe, expect, it } from "vitest";

import { countQuestionnaireProgress, type QuestionProgressRow } from "@/features/questionnaires/progress";

/**
 * The progress rule (plan §W4 data table "progress"): a question is resolved
 * when it is export-eligible in the D012 sense — a real answer or review
 * state, an AI disposition, or a conscious blank-by-choice. AI-drafting
 * states and the initial empty state are NOT progress.
 */

function row(status: QuestionProgressRow["status"], blankByChoice = false): QuestionProgressRow {
  return { status, blank_by_choice: blankByChoice };
}

describe("countQuestionnaireProgress", () => {
  it("counts an empty list as 0 of 0", () => {
    expect(countQuestionnaireProgress([])).toEqual({ resolved: 0, total: 0 });
  });

  it("does not count unanswered or still-drafting questions", () => {
    const progress = countQuestionnaireProgress([row("empty"), row("generating"), row("drafted")]);
    expect(progress).toEqual({ resolved: 0, total: 3 });
  });

  it("counts answered and every review state as resolved", () => {
    const progress = countQuestionnaireProgress([
      row("answered"),
      row("in_review"),
      row("approved"),
      row("changes_requested"),
      row("rejected"),
    ]);
    expect(progress).toEqual({ resolved: 5, total: 5 });
  });

  it("counts the AI insufficient_evidence disposition as resolved", () => {
    const progress = countQuestionnaireProgress([row("insufficient_evidence"), row("empty")]);
    expect(progress).toEqual({ resolved: 1, total: 2 });
  });

  it("counts a conscious blank-by-choice even from the empty state (D012)", () => {
    const progress = countQuestionnaireProgress([row("empty", true), row("empty")]);
    expect(progress).toEqual({ resolved: 1, total: 2 });
  });

  it("counts each question exactly once when answered AND blank-marked", () => {
    const progress = countQuestionnaireProgress([row("answered", true)]);
    expect(progress).toEqual({ resolved: 1, total: 1 });
  });
});
