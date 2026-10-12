/**
 * Live embedding smoke test (plan §W3 tests: "one tiny live embedding smoke
 * test, capped to a few cents").
 *
 * COST GATE: skipped unless BOTH `TEST_LIVE_EMBEDDINGS=1` is set AND an
 * OpenAI key exists — so CI pushes and normal `pnpm test:db` runs never spend
 * budget (AGENTS.md: never run live-AI tests on CI pushes; see
 * memory/budget-tracking.md before running this deliberately).
 *
 * Run: TEST_LIVE_EMBEDDINGS=1 pnpm test:db tests/integration/embeddings-live.test.ts
 */

import { describe, expect, it } from "vitest";

import { getEmbeddingProvider, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";

import { loadIntegrationEnv } from "./helpers/load-env";

// The key usually lives in `.env.local`, which nothing loads in this process
// until we do (this file never imports clients.ts). Loading at module scope
// means the flag checks below see the real values.
loadIntegrationEnv();

const wantsLive = process.env.TEST_LIVE_EMBEDDINGS === "1";
const keyVisible = process.env.OPENAI_API_KEY !== undefined && process.env.OPENAI_API_KEY.trim() !== "";
const enabled = wantsLive && keyVisible;

// A deliberate live run that cannot see a key must FAIL, not skip — a silent
// skip would look like a green gate that verified nothing (Session 12).
it.skipIf(!wantsLive || keyVisible)(
  "deliberate live run has a visible OPENAI_API_KEY (guard against silent skip)",
  () => {
    throw new Error(
      "TEST_LIVE_EMBEDDINGS=1 but OPENAI_API_KEY is not visible — .env.local missing/unreadable or key absent.",
    );
  },
);

describe.skipIf(!enabled)("live embeddings (budget-gated)", () => {
  it("embeds a tiny real input at the configured dimension", async () => {
    const provider = getEmbeddingProvider();
    if (provider === null) {
      throw new Error("TEST_LIVE_EMBEDDINGS set but provider unavailable — check OPENAI_API_KEY/AI_ENABLED");
    }
    // ~10 tokens of input: a fraction of a cent with text-embedding-3-small.
    const result = await provider.embed(["QuestCite live smoke test: encryption at rest."]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    const components = result[0] ?? [];
    expect(components.every((value) => typeof value === "number" && Number.isFinite(value))).toBe(true);
  });

  it("deduplicates identical content in one call (cost control)", async () => {
    const provider = getEmbeddingProvider();
    if (provider === null) {
      throw new Error("provider unavailable");
    }
    const text = "QuestCite live smoke test: backup recovery.";
    const result = await provider.embed([text, text, text]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(result[1]);
    expect(result[1]).toEqual(result[2]);
  });
});
