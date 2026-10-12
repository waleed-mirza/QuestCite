import { afterEach, describe, expect, it } from "vitest";

import { EmbeddingError, OpenAIEmbeddingProvider, getEmbeddingProvider } from "@/lib/ai/embeddings";
import { resetServerEnvCache } from "@/lib/env";

/**
 * Adapter behavior with a fake fetch: batching, in-call dedup, cache reuse,
 * and the rule that provider responses never leak into error text.
 */

type FetchCall = { input: string[] };

function fakeFetch(responder: (input: string[]) => unknown, calls: FetchCall[] = []): typeof fetch {
  const impl = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string[] };
    const input = body.input ?? [];
    calls.push({ input });
    const data = input.map((text) => ({ embedding: [text.length, text.charCodeAt(0) ?? 0], index: 0 }));
    const payload = responder(input) ?? { data };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return impl;
}

const withEnv = (overrides: Record<string, string | undefined>, run: () => void): void => {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetServerEnvCache();
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetServerEnvCache();
  }
};

afterEach(() => {
  resetServerEnvCache();
});

describe("OpenAIEmbeddingProvider", () => {
  it("preserves input order across batches", async () => {
    const calls: FetchCall[] = [];
    const provider = new OpenAIEmbeddingProvider("key", "text-embedding-3-small", fakeFetch(() => null, calls));
    const texts = Array.from({ length: 150 }, (_, i) => `text number ${i}`);
    const result = await provider.embed(texts);
    expect(result).toHaveLength(150);
    // Each embedding echoes the input's first chars — order must match.
    expect(result[0]?.[0]).toBe(texts[0]?.length);
    expect(result[149]?.[0]).toBe(texts[149]?.length);
    expect(calls.length).toBe(3); // 64 + 64 + 22
  });

  it("embeds identical content once per call and maps it back", async () => {
    const calls: FetchCall[] = [];
    const provider = new OpenAIEmbeddingProvider("key", "m", fakeFetch(() => null, calls));
    const result = await provider.embed(["same", "other", "same", "same"]);
    expect(result[0]).toEqual(result[2]);
    expect(result[0]).toEqual(result[3]);
    expect(calls[0]?.input).toEqual(["same", "other"]);
  });

  it("reuses the process cache for unchanged content (no second HTTP call)", async () => {
    const calls: FetchCall[] = [];
    const provider = new OpenAIEmbeddingProvider("key", "m", fakeFetch(() => null, calls));
    await provider.embed(["stable content"]);
    await provider.embed(["stable content", "new content"]);
    expect(calls.length).toBe(2);
    expect(calls[1]?.input).toEqual(["new content"]);
  });

  it("maps network and http failures to EMBEDDING_FAILED without echoing input", async () => {
    const failing: typeof fetch = async () => {
      throw new Error("socket hang up with secret fragment");
    };
    const provider = new OpenAIEmbeddingProvider("key", "m", failing);
    try {
      await provider.embed(["input that must never appear in errors"]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EmbeddingError);
      expect((error as EmbeddingError).code).toBe("EMBEDDING_FAILED");
      expect((error as EmbeddingError).message).toBe("EMBEDDING_FAILED");
    }
  });

  it("maps malformed responses to EMBEDDING_RESPONSE_INVALID", async () => {
    const provider = new OpenAIEmbeddingProvider("key", "m", fakeFetch(() => ({ data: [] })));
    await expect(provider.embed(["a"])).rejects.toMatchObject({ code: "EMBEDDING_RESPONSE_INVALID" });
  });
});

describe("getEmbeddingProvider", () => {
  it("returns null when AI is disabled or the key is missing", () => {
    withEnv({ AI_ENABLED: "false", OPENAI_API_KEY: "key" }, () => {
      expect(getEmbeddingProvider()).toBeNull();
    });
    withEnv({ AI_ENABLED: "true", OPENAI_API_KEY: undefined }, () => {
      expect(getEmbeddingProvider()).toBeNull();
    });
  });

  it("returns a provider wired to the configured model", () => {
    withEnv({ AI_ENABLED: "true", OPENAI_API_KEY: "key", OPENAI_EMBEDDING_MODEL: "test-model" }, () => {
      const provider = getEmbeddingProvider();
      expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    });
  });
});
