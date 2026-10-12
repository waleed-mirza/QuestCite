import "server-only";

import { getServerEnv } from "@/lib/env";
import { sha256Text } from "@/lib/files/checksum";

/**
 * Embedding adapter (plan §6/§9/§10). A small interface on purpose: tests use
 * a fake, a future buyer can swap providers, and nothing outside this module
 * knows OpenAI's wire format.
 *
 * Cost controls (plan §10): model is `text-embedding-3-small` by default,
 * requests are batched, and identical content is embedded once per process
 * via a checksum-keyed cache (same bytes → same chunks → cache hits, which is
 * also what makes retry after an embedding outage nearly free).
 *
 * Errors surface as stable uppercase codes — the provider response body can
 * echo input fragments and is therefore never included in the error text.
 */

export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  readonly code: "EMBEDDING_FAILED" | "EMBEDDING_UNAVAILABLE" | "EMBEDDING_RESPONSE_INVALID";

  constructor(code: "EMBEDDING_FAILED" | "EMBEDDING_UNAVAILABLE" | "EMBEDDING_RESPONSE_INVALID") {
    super(code);
    this.name = "EmbeddingError";
    this.code = code;
  }
}

/** Max inputs per HTTP request (provider cap is far higher; keeps requests small). */
const BATCH_SIZE = 64;
/** Per-request character ceiling ~ matches the provider's per-request token budget conservatively. */
const BATCH_CHAR_BUDGET = 300_000;
const CACHE_MAX_ENTRIES = 2_000;

type OpenAiEmbeddingsResponse = {
  data?: Array<{ embedding?: unknown; index?: unknown }>;
};

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, number[]>();

  constructor(apiKey: string, model: string, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Embeds `texts`, deduplicating identical content within the call and
   * reusing the process cache. Result order matches input order exactly.
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const results = new Array<number[]>(texts.length);
    const pending = new Map<string, number[]>();
    texts.forEach((text, index) => {
      const cached = this.cache.get(sha256Text(text));
      if (cached !== undefined) {
        results[index] = cached;
        return;
      }
      const group = pending.get(text);
      if (group === undefined) {
        pending.set(text, [index]);
      } else {
        group.push(index);
      }
    });

    const uniqueTexts = [...pending.keys()];
    for (const [start, end] of batchRanges(uniqueTexts)) {
      const embeddings = await this.requestEmbeddings(uniqueTexts.slice(start, end));
      embeddings.forEach((embedding, offset) => {
        const text = uniqueTexts[start + offset];
        if (text === undefined) {
          throw new EmbeddingError("EMBEDDING_RESPONSE_INVALID");
        }
        remember(this.cache, text, embedding);
        for (const index of pending.get(text) ?? []) {
          results[index] = embedding;
        }
      });
    }

    return results.map((embedding) => {
      if (embedding === undefined) {
        throw new EmbeddingError("EMBEDDING_RESPONSE_INVALID");
      }
      return embedding;
    });
  }

  private async requestEmbeddings(batch: string[]): Promise<number[][]> {
    let response: Response;
    try {
      response = await this.fetchImpl("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: batch,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      });
    } catch {
      throw new EmbeddingError("EMBEDDING_FAILED");
    }

    if (!response.ok) {
      // Status only. The body may echo input text and is discarded.
      throw new EmbeddingError(response.status === 429 ? "EMBEDDING_FAILED" : "EMBEDDING_FAILED");
    }

    let parsed: OpenAiEmbeddingsResponse;
    try {
      parsed = (await response.json()) as OpenAiEmbeddingsResponse;
    } catch {
      throw new EmbeddingError("EMBEDDING_RESPONSE_INVALID");
    }

    const data = parsed.data;
    if (!Array.isArray(data) || data.length !== batch.length) {
      throw new EmbeddingError("EMBEDDING_RESPONSE_INVALID");
    }

    return data.map((entry) => {
      if (
        entry === null || typeof entry !== "object"
        || !Array.isArray(entry.embedding)
        || entry.embedding.some((component) => typeof component !== "number")
      ) {
        throw new EmbeddingError("EMBEDDING_RESPONSE_INVALID");
      }
      return entry.embedding as number[];
    });
  }
}

function batchRanges(texts: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = 0;
  let chars = 0;
  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index] ?? "";
    if (index > start && (index - start >= BATCH_SIZE || chars + text.length > BATCH_CHAR_BUDGET)) {
      ranges.push([start, index]);
      start = index;
      chars = 0;
    }
    chars += text.length;
  }
  ranges.push([start, texts.length]);
  return ranges;
}

function remember(cache: Map<string, number[]>, text: string, embedding: number[]): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }
  cache.set(sha256Text(text), embedding);
}

/**
 * Returns the configured provider, or `null` when AI is disabled or the API
 * key is absent — callers must treat null as "embedding unavailable" and fail
 * the version SAFELY (EMBEDDING_UNAVAILABLE), never skip the step silently.
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  const env = getServerEnv();
  if (!env.AI_ENABLED || env.OPENAI_API_KEY === undefined) {
    return null;
  }
  return new OpenAIEmbeddingProvider(env.OPENAI_API_KEY, env.OPENAI_EMBEDDING_MODEL);
}
