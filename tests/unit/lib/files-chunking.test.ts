import { describe, expect, it } from "vitest";

import { CHUNK_MAX_TOKENS, CHUNK_MIN_TOKENS } from "@/config/ingestion";
import {
  chunkText,
  estimateTokens,
  groupChunksByChecksum,
  isHeading,
  normalizeExtractedText,
} from "@/lib/files/chunking";

const paragraph = (sentences: number, seed = "a"): string =>
  Array.from({ length: sentences }, (_, i) => `Sentence ${i + 1} about ${seed} policy with enough words to matter.`).join(" ");

describe("normalizeExtractedText", () => {
  it("unifies line endings and collapses blank-line runs", () => {
    expect(normalizeExtractedText("a\r\nb\r\r\rc\r\n\r\n\r\nd")).toBe("a\nb\n\nc\n\nd");
  });

  it("strips control characters but keeps tabs and newlines", () => {
    const text = `a${String.fromCodePoint(1)}b\tc${String.fromCodePoint(127)}`;
    expect(normalizeExtractedText(text)).toBe("ab\tc");
  });

  it("applies unicode NFKC (ligatures fold)", () => {
    expect(normalizeExtractedText("ﬁle")).toBe("file");
  });

  it("trims outer whitespace", () => {
    expect(normalizeExtractedText("  \n\n hello \n\n ")).toBe("hello");
  });
});

describe("isHeading", () => {
  it("detects markdown headings and short prose headings", () => {
    expect(isHeading("# Access Control")).toBe(true);
    expect(isHeading("Access Control Policy")).toBe(true);
  });

  it("rejects sentences, list items, and TOC entries", () => {
    expect(isHeading("This line ends in a period.")).toBe(false);
    expect(isHeading("- bullet point item")).toBe(false);
    expect(isHeading("1. numbered item")).toBe(false);
    expect(isHeading("Overview .......... 12")).toBe(false);
    expect(isHeading("A sentence that keeps going well past any reasonable heading length limit for a title.")).toBe(false);
  });
});

describe("chunkText", () => {
  it("keeps chunks inside the 600–900 token band", () => {
    const text = Array.from({ length: 40 }, (_, i) => paragraph(4, `topic-${i}`)).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.tokenCount).toBeGreaterThanOrEqual(CHUNK_MIN_TOKENS * 0.8);
      expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
    }
  });

  it("produces deterministic output and stable checksums", () => {
    const text = `${paragraph(10, "x")}\n\n${paragraph(10, "y")}`;
    const first = chunkText(text);
    const second = chunkText(text);
    expect(first).toEqual(second);
    for (const chunk of first) {
      expect(chunk.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("carries a trailing overlap into the next chunk", () => {
    const text = Array.from({ length: 12 }, (_, i) => paragraph(4, `t-${i}`)).join("\n\n");
    const chunks = chunkText(text, { minTokens: 200, maxTokens: 300, overlapTokens: 60 });
    expect(chunks.length).toBeGreaterThan(1);
    const first = chunks[0];
    const second = chunks[1];
    if (first === undefined || second === undefined) {
      throw new Error("expected at least two chunks");
    }
    // The overlap is a WORD-SEQUENCE suffix of chunk1 reopened at the start of
    // chunk2 (compared word-wise because paragraph joins flatten newlines to
    // spaces — the overlap is a retrieval hint, not a quote). The carried
    // context must be non-trivial: at least five words.
    const firstWords = first.content.split(/\s+/);
    const secondWords = second.content.split(/\s+/);
    let overlapWords = 0;
    for (let k = Math.min(firstWords.length, secondWords.length, 80); k >= 5; k -= 1) {
      const tail = firstWords.slice(-k).join(" ");
      const head = secondWords.slice(0, k).join(" ");
      if (tail === head) {
        overlapWords = k;
        break;
      }
    }
    expect(overlapWords).toBeGreaterThanOrEqual(5);
  });

  it("preserves the section label of markdown headings", () => {
    const md = "# Encryption\n\n" + paragraph(6, "keys") + "\n\n## Key Rotation\n\n" + paragraph(6, "rotation");
    const chunks = chunkText(md, { minTokens: 50, maxTokens: 120, overlapTokens: 10 });
    const first = chunks[0];
    if (first === undefined) {
      throw new Error("expected at least one chunk");
    }
    expect(first.section).toBe("Encryption");
    const rotationChunk = chunks.find((chunk) => chunk.section === "Key Rotation");
    expect(rotationChunk).toBeDefined();
  });

  it("splits a single oversized paragraph by sentence, never exceeding maxTokens", () => {
    const huge = paragraph(60, "monster");
    const chunks = chunkText(huge, { minTokens: 200, maxTokens: 300, overlapTokens: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(300);
    }
  });

  it("returns an empty array for blank input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("sequences chunks from zero", () => {
    const chunks = chunkText(Array.from({ length: 10 }, (_, i) => paragraph(4, `s-${i}`)).join("\n\n"));
    expect(chunks.map((chunk) => chunk.sequence)).toEqual(chunks.map((_, i) => i));
  });
});

describe("groupChunksByChecksum", () => {
  it("groups identical content and preserves every member", () => {
    // Two large identical blocks, no overlap: each becomes its own chunk with
    // the exact same content → same checksum → one group with two members.
    const duplicatedBlock = paragraph(45, "dup");
    const chunks = chunkText(`${duplicatedBlock}\n\n${duplicatedBlock}`, { overlapTokens: 0 });
    expect(chunks.length).toBe(2);
    const groups = groupChunksByChecksum(chunks);
    expect(groups.size).toBe(1);
    const group = [...groups.values()][0];
    if (group === undefined) {
      throw new Error("expected one group");
    }
    expect(group).toHaveLength(2);
  });
});

describe("estimateTokens", () => {
  it("approximates 4 characters per token", () => {
    expect(estimateTokens("a".repeat(40))).toBe(10);
    expect(estimateTokens("")).toBe(1);
  });
});
