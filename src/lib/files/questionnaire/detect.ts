/**
 * Question/answer/notes column detection (plan §9 step 3).
 *
 * Detection produces SUGGESTIONS ONLY — plan step 4: "Show a user-controlled
 * mapping preview; never silently trust detection." The mapping UI always
 * requires explicit user confirmation; low-confidence detections preselect
 * nothing beyond what the scores say, and a null column means "user must
 * choose".
 *
 * Pure and client-safe: operates on the rendered string matrix produced by
 * the inspector (so CSV and XLSX share one detection path).
 */

import type { SheetInspection } from "./types";

/** Normalized header lexicons (lowercase, alphanumeric only). */
const QUESTION_HEADERS = new Set([
  "question", "questions", "questiontext", "item", "items", "requirement",
  "requirements", "control", "controlname", "controls", "prompt", "query",
  "assessmentitem", "statement",
]);
const ANSWER_HEADERS = new Set([
  "answer", "answers", "response", "responses", "youranswer", "yourresponse",
  "answertext", "clientresponse", "vendorresponse", "supplierresponse", "reply",
]);
const NOTES_HEADERS = new Set([
  "note", "notes", "comment", "comments", "remark", "remarks", "evidence",
  "guidance", "hint", "hints", "reference", "references",
]);

/**
 * Total-evidence floor (header 0–1 + content 0–1 = 0–2 scale) below which a
 * column is never preselected — the user maps manually.
 */
const MIN_CONFIDENCE = 0.75;
const HEADER_SCAN_ROWS = 10;
const CONTENT_SCAN_ROWS = 200;
const LONG_TEXT_CHARS = 25;

export type ColumnDetection = {
  /** 0-based row index of the detected header row; -1 when nothing looked like one. */
  headerRowIndex: number;
  questionColumn: number | null;
  answerColumn: number | null;
  notesColumn: number | null;
  /** Additive evidence per role (header lexicon + content/emptiness signals). */
  confidence: { question: number; answer: number; notes: number };
};

export function detectColumns(sheet: SheetInspection): ColumnDetection {
  const headerRowIndex = findHeaderRow(sheet.matrix);
  const hasHeader = headerRowIndex >= 0;
  const dataRows = sheet.matrix.slice(hasHeader ? headerRowIndex + 1 : 0, (hasHeader ? headerRowIndex + 1 : 0) + CONTENT_SCAN_ROWS);
  const columnCount = Math.max(...sheet.matrix.map((row) => row.length), 0);

  const question = new Array<number>(columnCount).fill(0);
  const answer = new Array<number>(columnCount).fill(0);
  const notes = new Array<number>(columnCount).fill(0);

  for (let column = 0; column < columnCount; column += 1) {
    const header = hasHeader ? normalize(sheet.matrix[headerRowIndex]?.[column] ?? "") : "";
    question[column] = headerScore(header, QUESTION_HEADERS);
    answer[column] = headerScore(header, ANSWER_HEADERS);
    notes[column] = headerScore(header, NOTES_HEADERS);

    const samples = dataRows
      .map((row) => row[column] ?? "")
      .filter((value) => value.trim() !== "")
      .slice(0, CONTENT_SCAN_ROWS);
    if (samples.length > 0) {
      const longRatio = samples.filter((value) => value.length >= LONG_TEXT_CHARS).length / samples.length;
      const questionMarkRatio = samples.filter((value) => value.includes("?")).length / samples.length;
      // Additive content evidence (0–1): long, question-shaped text. It counts
      // with OR without a header row — without one it is the only signal
      // (rescues headerless sheets), and with one it breaks ties BETWEEN two
      // lexicon-matching columns ("Item #" vs a column of actual questions).
      question[column] = (question[column] ?? 0) + 0.5 * longRatio + 0.5 * questionMarkRatio;
    }
  }

  // Answer columns in customer templates are usually the empty ones to fill.
  if (hasHeader) {
    for (let column = 0; column < columnCount; column += 1) {
      const dataRowsForColumn = dataRows.length;
      if (dataRowsForColumn === 0) continue;
      const filled = dataRows.filter((row) => (row[column] ?? "").trim() !== "").length;
      const emptyRatio = 1 - filled / dataRowsForColumn;
      // Additive like the question role: an explicitly labeled, empty column
      // is the IDEAL answer/notes target, so its evidence stacks. An empty
      // column with no label still stays under the floor (0.3 / 0.2).
      answer[column] = (answer[column] ?? 0) + emptyRatio * 0.3;
      notes[column] = (notes[column] ?? 0) + emptyRatio * 0.2;
    }
  }

  const questionColumn = pickBest(question, []);
  const answerColumn = pickBest(answer, without(questionColumn));
  const notesColumn = pickBest(notes, without(questionColumn, answerColumn));

  return {
    headerRowIndex,
    questionColumn,
    answerColumn,
    notesColumn,
    confidence: {
      question: questionColumn === null ? 0 : question[questionColumn] ?? 0,
      answer: answerColumn === null ? 0 : answer[answerColumn] ?? 0,
      notes: notesColumn === null ? 0 : notes[notesColumn] ?? 0,
    },
  };
}

function without(...columns: Array<number | null>): number[] {
  return columns.filter((column): column is number => column !== null);
}

function pickBest(scores: number[], excluded: number[]): number | null {
  let best = -1;
  let bestScore = MIN_CONFIDENCE;
  for (let column = 0; column < scores.length; column += 1) {
    const score = scores[column] ?? 0;
    if (excluded.includes(column)) continue;
    if (score > bestScore) {
      bestScore = score;
      best = column;
    }
  }
  // Strictly-greater comparison keeps the LEFTMOST column on ties and null
  // when nothing clears the floor.
  return best >= 0 ? best : null;
}

function findHeaderRow(matrix: string[][]): number {
  const scanLimit = Math.min(matrix.length, HEADER_SCAN_ROWS);
  let firstPartialHit = -1;
  let firstContentful = -1;

  for (let row = 0; row < scanLimit; row += 1) {
    const cells = matrix[row] ?? [];
    const normalizedCells = cells.filter((value) => value.trim() !== "").map(normalize);
    if (firstContentful < 0 && normalizedCells.length >= 2) {
      firstContentful = row;
    }
    const exactHits = normalizedCells.filter((value) => isLexiconWord(value)).length;
    // A real header row matches the lexicon EXACTLY on its labels. Substring
    // matches ("question" inside a merged title like "Security
    // Questionnaire 2026") must never promote a title row to header status.
    if (exactHits >= 2) {
      return row;
    }
    if (exactHits === 1 && firstPartialHit < 0) {
      firstPartialHit = row;
    }
  }
  if (firstPartialHit >= 0) {
    return firstPartialHit;
  }
  return firstContentful;
}

function isLexiconWord(value: string): boolean {
  return QUESTION_HEADERS.has(value) || ANSWER_HEADERS.has(value) || NOTES_HEADERS.has(value);
}

function headerScore(header: string, lexicon: Set<string>): number {
  if (header === "") {
    return 0;
  }
  if (lexicon.has(header)) {
    return 1;
  }
  // Strongest tier across ALL candidates — never the first Set hit
  // ("reviewerremarks" includes "remark" weakly but ENDS WITH "remarks").
  let best = 0;
  for (const candidate of lexicon) {
    // Prefix AND suffix: real headers attach lexicon words on either side
    // ("Item #" prefixes "item"; "Reviewer Remarks" suffixes "remarks").
    if (candidate.length >= 3 && (header.startsWith(candidate) || header.endsWith(candidate))) {
      best = Math.max(best, 0.7);
    } else if (candidate.length >= 4 && header.includes(candidate)) {
      best = Math.max(best, 0.5);
    }
  }
  return best;
}

function normalize(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}
