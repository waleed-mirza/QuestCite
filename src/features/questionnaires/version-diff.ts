/**
 * Answer version compare (plan §W6 "answer version history and compare view").
 *
 * Line-based LCS diff, pure and UI-agnostic: the compare view renders the
 * ops as added/removed/context rows. Answers are capped at 10,000 characters
 * (DB constraint), so a 200×200 DP table is the realistic worst case; inputs
 * above MAX_DIFF_LINES fall back to a whole-block replace so the function
 * stays O(1) in memory beyond the cap instead of degrading.
 */

/** Guard rail: beyond this many lines per side, emit one replace pair. */
export const MAX_DIFF_LINES = 400;

export type DiffOp = {
  type: "same" | "added" | "removed";
  text: string;
};

export function splitLines(text: string): string[] {
  if (text === "") {
    return [];
  }
  return text.split(/\r\n|\r|\n/);
}

export function diffLines(before: string, after: string): DiffOp[] {
  const a = splitLines(before);
  const b = splitLines(after);

  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    const ops: DiffOp[] = [];
    if (a.length > 0) {
      ops.push({ type: "removed", text: before });
    }
    if (b.length > 0) {
      ops.push({ type: "added", text: after });
    }
    return ops;
  }

  // LCS length table (classic DP).
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    // Indices are in-bounds by construction; the guards exist for the
    // noUncheckedIndexedAccess view of the same fact.
    const row = table[i];
    const next = table[i + 1];
    if (row === undefined || next === undefined) {
      continue;
    }
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: "same", text: a[i] ?? "" });
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      ops.push({ type: "removed", text: a[i] ?? "" });
      i += 1;
    } else {
      ops.push({ type: "added", text: b[j] ?? "" });
      j += 1;
    }
  }
  while (i < a.length) {
    ops.push({ type: "removed", text: a[i] ?? "" });
    i += 1;
  }
  while (j < b.length) {
    ops.push({ type: "added", text: b[j] ?? "" });
    j += 1;
  }
  return ops;
}

export type DiffStats = { added: number; removed: number; unchanged: number };

export function diffStats(ops: DiffOp[]): DiffStats {
  const stats: DiffStats = { added: 0, removed: 0, unchanged: 0 };
  for (const op of ops) {
    if (op.type === "added") stats.added += 1;
    if (op.type === "removed") stats.removed += 1;
    if (op.type === "same") stats.unchanged += 1;
  }
  return stats;
}
