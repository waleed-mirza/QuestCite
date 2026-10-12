import {
  CHUNK_MAX_TOKENS,
  CHUNK_MIN_TOKENS,
  CHUNK_OVERLAP_TOKENS,
  TOKEN_CHARS,
} from "@/config/ingestion";
import { sha256Text } from "@/lib/files/checksum";

/**
 * Text normalization + chunking (plan §9).
 *
 * Extracted text is normalized (line endings, control characters, unicode
 * compatibility forms) while PRESERVING structure: headings survive as
 * section labels attached to the chunks below them, so citations can later
 * point at "Access Control > Session Timeout" instead of a bare number.
 *
 * Chunking targets plan's 600–900 token band with a modest trailing overlap.
 * Token counts are ESTIMATES at ~4 characters/token (documented in
 * src/config/ingestion.ts); chunk boundaries are deterministic, which is what
 * makes reprocessing idempotent: same bytes → same chunks → same checksums →
 * embedding cache hits on retry.
 */

export type Chunk = {
  sequence: number;
  section: string;
  content: string;
  tokenCount: number;
  checksumSha256: string;
};

export type ChunkingOptions = {
  minTokens?: number;
  maxTokens?: number;
  overlapTokens?: number;
};

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / TOKEN_CHARS));
}

/**
 * Normalizes parser output without destroying document structure:
 * - unicode NFKC (folds ligatures, full-width forms)
 * - CRLF/CR → LF
 * - removes control characters except \n and \t
 * - trailing whitespace per line, 3+ blank lines collapse to one
 */
export function normalizeExtractedText(raw: string): string {
  const withoutControls = raw
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  const lines = withoutControls
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""));
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Detects section labels for headings. Deliberately conservative:
 * - Markdown ATX headings (# .. ######)
 * - short lines without terminal punctuation (setext-style prose headings,
 *   e.g. "Access Control Policy") — ALL-CAPS or not
 * A heading is never a numbered list item or a sentence.
 */
export function isHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") {
    return false;
  }
  if (/^#{1,6}\s+\S/.test(trimmed)) {
    return true;
  }
  if (trimmed.length > 120 || trimmed.length < 3) {
    return false;
  }
  if (/^\d+[.)]\s/.test(trimmed)) {
    return false;
  }
  if (/[.!?:;]$/.test(trimmed)) {
    return false;
  }
  if (/^[-*+]\s/.test(trimmed)) {
    return false;
  }
  // Tables of contents entries ("Overview ......... 12") are not headings.
  if (/\.{2,}\s*\d+$/.test(trimmed)) {
    return false;
  }
  const words = trimmed.split(/\s+/);
  return words.length <= 12;
}

/**
 * Splits one oversized paragraph by sentences (then words) so no chunk ever
 * exceeds maxTokens, even with degenerate input (no sentence punctuation).
 */
function splitHard(paragraph: string, maxTokenChars: number): string[] {
  const sentences = paragraph
    .split(/(?<=[.!?])\s+(?=[^\s])/)
    .filter((sentence) => sentence.trim() !== "");
  const pieces: string[] = [];
  let current = "";
  const pushCurrent = () => {
    if (current.trim() !== "") {
      pieces.push(current.trim());
    }
    current = "";
  };
  for (const sentence of sentences) {
    if (estimateTokens(sentence) > maxTokenChars / TOKEN_CHARS) {
      // Single monstrous sentence: fall back to word-boundary splitting.
      pushCurrent();
      const words = sentence.split(/\s+/);
      for (const word of words) {
        if (estimateTokens(current + " " + word) > maxTokenChars / TOKEN_CHARS && current !== "") {
          pushCurrent();
        }
        current = current === "" ? word : current + " " + word;
      }
      pushCurrent();
      continue;
    }
    if (estimateTokens(current + " " + sentence) > maxTokenChars / TOKEN_CHARS && current !== "") {
      pushCurrent();
    }
    current = current === "" ? sentence : current + " " + sentence;
  }
  pushCurrent();
  return pieces;
}

function trailingOverlap(content: string, overlapTokenChars: number): string {
  if (overlapTokenChars <= 0) {
    return "";
  }
  const words = content.split(/\s+/).filter(Boolean);
  const overlap: string[] = [];
  let used = 0;
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const word = words[i] ?? "";
    const next = used + word.length + (overlap.length > 0 ? 1 : 0);
    if (next > overlapTokenChars) {
      break;
    }
    overlap.unshift(word);
    used = next;
  }
  return overlap.join(" ");
}

/**
 * Chunks normalized text into plan's 600–900 token band (defaults) with a
 * trailing overlap carried into the next chunk. Paragraph boundaries are
 * respected wherever possible; only single paragraphs larger than maxTokens
 * get sentence/word splitting. Merging continues until maxTokens, so interior
 * chunks land near the top of the band; the FINAL chunk of a document may sit
 * below minTokens — that is expected, not a defect.
 */
export function chunkText(normalized: string, options: ChunkingOptions = {}): Chunk[] {
  const minTokens = options.minTokens ?? CHUNK_MIN_TOKENS;
  const maxTokens = options.maxTokens ?? CHUNK_MAX_TOKENS;
  const overlapTokens = options.overlapTokens ?? CHUNK_OVERLAP_TOKENS;
  if (minTokens > maxTokens) {
    throw new Error("CHUNK_CONFIG_INVALID");
  }

  const maxTokenChars = maxTokens * TOKEN_CHARS;
  const overlapTokenChars = overlapTokens * TOKEN_CHARS;

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
    .filter((paragraph) => paragraph !== "");

  // Pre-split oversized paragraphs; track the heading each piece belongs to.
  let currentSection = "";
  const blocks: Array<{ content: string; section: string }> = [];
  for (const paragraph of paragraphs) {
    const lines = paragraph.split("\n");
    const firstLine = (lines[0] ?? "").trim();
    if (lines.length > 1 && isHeading(firstLine)) {
      currentSection = firstLine.replace(/^#{1,6}\s+/, "");
      lines.shift();
    } else if (lines.length === 1 && isHeading(paragraph)) {
      currentSection = paragraph.replace(/^#{1,6}\s+/, "");
      continue;
    }
    const body = lines.join(" ").trim();
    if (body === "") {
      continue;
    }
    if (estimateTokens(body) > maxTokens) {
      for (const piece of splitHard(body, maxTokenChars)) {
        blocks.push({ content: piece, section: currentSection });
      }
    } else {
      blocks.push({ content: body, section: currentSection });
    }
  }

  const chunks: Chunk[] = [];
  let pendingContent = "";
  let pendingSection = "";
  let pendingHasContent = false;

  const startNew = (block: { content: string; section: string }): void => {
    pendingContent = block.content;
    pendingSection = block.section;
    pendingHasContent = true;
  };

  // Emits the open chunk and seeds `pendingContent` with its trailing overlap
  // (the overlap belongs to the flushed chunk's section until the next block
  // starts — the next block overwrites the section label when it merges).
  const flush = (): void => {
    if (!pendingHasContent) {
      return;
    }
    const content = pendingContent.trim();
    pendingHasContent = false;
    if (content === "") {
      return;
    }
    chunks.push({
      sequence: chunks.length,
      section: pendingSection,
      content,
      tokenCount: estimateTokens(content),
      checksumSha256: sha256Text(content),
    });
    const overlap = trailingOverlap(content, overlapTokenChars);
    pendingContent = overlap;
    pendingHasContent = overlap !== "";
  };

  for (const block of blocks) {
    if (!pendingHasContent) {
      startNew(block);
      continue;
    }
    const candidate = pendingContent + "\n\n" + block.content;
    if (estimateTokens(candidate) <= maxTokens) {
      // Merging forward keeps the section where the chunk STARTED.
      pendingContent = candidate;
      continue;
    }
    flush();
    if (pendingHasContent) {
      const withOverlap = pendingContent + "\n\n" + block.content;
      if (estimateTokens(withOverlap) <= maxTokens) {
        pendingContent = withOverlap;
        pendingSection = block.section;
        continue;
      }
      // Overlap plus this block would already overflow: drop the overlap.
    }
    startNew(block);
  }
  // Final flush for whatever remains open.
  flush();

  return chunks;
}

/**
 * Unique chunks by content checksum with a map back to every sequence that
 * referenced them — used to embed each distinct text exactly once per batch
 * (embedding cache + cost control, plan §10).
 */
export function groupChunksByChecksum(chunks: Chunk[]): Map<string, Chunk[]> {
  const groups = new Map<string, Chunk[]>();
  for (const chunk of chunks) {
    const group = groups.get(chunk.checksumSha256);
    if (group === undefined) {
      groups.set(chunk.checksumSha256, [chunk]);
    } else {
      group.push(chunk);
    }
  }
  return groups;
}
