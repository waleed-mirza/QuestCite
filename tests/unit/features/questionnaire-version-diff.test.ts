import { describe, expect, it } from "vitest";

import { diffLines, diffStats, MAX_DIFF_LINES, splitLines } from "@/features/questionnaires/version-diff";

/**
 * Answer version compare (plan §W6): the pure line diff that powers the
 * compare view. Pinned here so the review UI's added/removed rendering can
 * never silently drift from what actually changed between two versions.
 */

describe("splitLines", () => {
  it("handles LF, CRLF, CR, and empty input", () => {
    expect(splitLines("a\nb\r\nc\rd")).toEqual(["a", "b", "c", "d"]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("single")).toEqual(["single"]);
  });
});

describe("diffLines", () => {
  it("identical text yields only context ops", () => {
    const ops = diffLines("same text\nline two", "same text\nline two");
    expect(ops.every((op) => op.type === "same")).toBe(true);
    expect(diffStats(ops)).toEqual({ added: 0, removed: 0, unchanged: 2 });
  });

  it("marks edited lines as a remove + add pair and keeps the rest", () => {
    const ops = diffLines("keep\nold value\nkeep too", "keep\nnew value\nkeep too");
    expect(ops).toEqual([
      { type: "same", text: "keep" },
      { type: "removed", text: "old value" },
      { type: "added", text: "new value" },
      { type: "same", text: "keep too" },
    ]);
    expect(diffStats(ops)).toEqual({ added: 1, removed: 1, unchanged: 2 });
  });

  it("handles pure additions and pure removals", () => {
    expect(diffStats(diffLines("a\nb", "a\nb\nc"))).toEqual({ added: 1, removed: 0, unchanged: 2 });
    expect(diffStats(diffLines("a\nb\nc", "a"))).toEqual({ added: 0, removed: 2, unchanged: 1 });
  });

  it("keeps exactly one common line for reordered blocks (LCS, not naive zip)", () => {
    const ops = diffLines("x\nshared\ny", "y\nshared\nx");
    // Any single line is a maximal common subsequence here; pin the count,
    // not which line the tie-break preferred.
    const sameTexts = ops.filter((op) => op.type === "same");
    expect(sameTexts).toHaveLength(1);
    expect(diffStats(ops)).toEqual({ added: 2, removed: 2, unchanged: 1 });
  });

  it("falls back to a whole-block replace beyond the line cap", () => {
    const big = Array.from({ length: MAX_DIFF_LINES + 1 }, (_, i) => `line ${i}`).join("\n");
    const ops = diffLines(big, "brand new answer");
    expect(ops).toEqual([
      { type: "removed", text: big },
      { type: "added", text: "brand new answer" },
    ]);
  });

  it("empty-before diff is a pure addition", () => {
    expect(diffLines("", "only line")).toEqual([{ type: "added", text: "only line" }]);
  });
});
