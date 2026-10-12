/**
 * Live Week 5 model evaluation. The final assertion enforces the suite cap
 * in code.
 *
 * COST GATE: skipped unless BOTH `TEST_LIVE_ANSWERS=1` is set AND a provider
 * is configured — CI pushes and normal `pnpm test:db` runs never spend budget
 * (AGENTS.md: never run live-AI tests on CI pushes).
 *
 * The suite drives the REAL drafting path over the deterministic 50-case W5
 * corpus: retrieval selection → versioned prompt → configured model (strict
 * Structured Output) → contract validation. It hard-asserts the SAFETY
 * CONTRACT (citation integrity, abstention on no evidence, stale never high
 * strength, budget cap) which the architecture guarantees, and REPORTS the
 * model-quality metrics (answered rates, expected-source citation rate, token
 * totals, estimated cost) without gating on them — a quality threshold would
 * burn budget on retry loops against a stochastic model.
 *
 * Run: TEST_LIVE_ANSWERS=1 pnpm test:db tests/integration/answer-live.test.ts
 */

import { describe, expect, it } from "vitest";

import { estimateCostMicroUsd, getAnswerProvider, type AnswerProvider } from "@/lib/ai/answer-provider";
import { draftAnswer } from "@/server/services/drafting";
import { selectEvidence } from "@/server/services/retrieval";

import { loadIntegrationEnv } from "./helpers/load-env";
import { W5_CORPUS } from "../fixtures/ai/w5-corpus";

loadIntegrationEnv();

const wantsLive = process.env.TEST_LIVE_ANSWERS === "1";
const liveProvider = wantsLive ? getAnswerProvider() : null;
const enabled = liveProvider !== null;

// Same loud-failure guard as embeddings-live: a deliberate live run that
// cannot reach the provider must FAIL, never report a silent skip as green.
it.skipIf(!wantsLive || enabled)("deliberate live run has a configured answer provider (guard against silent skip)", () => {
  throw new Error(
    "TEST_LIVE_ANSWERS=1 but no answer provider is configured — check OPENAI_API_KEY/AI_ENABLED in .env.local.",
  );
});

function requireProvider(): AnswerProvider {
  if (liveProvider === null) {
    // Unreachable when the suite runs (skipIf above), but keeps types honest
    // without assertions.
    throw new Error("live provider unavailable — suite should have been skipped");
  }
  return liveProvider;
}

const TODAY = new Date().toISOString().slice(0, 10);
/** Production fidelity: the run loop caps per-call output at 1,200 (route.ts:60). */
const MAX_OUTPUT_TOKENS = 1_200;
/** Week 5 budget cap in micro-USD (memory/budget-tracking.md). */
const W5_BUDGET_MICRO_USD = 1_500_000;

const ledger = { inputTokens: 0, outputTokens: 0, calls: 0, failed: 0 };
const answeredByClass = new Map<string, { answered: number; total: number }>();
const citedExpected = { hit: 0, eligible: 0 };

describe.skipIf(!enabled)("live W5 model evaluation (budget-gated)", () => {
  for (const item of W5_CORPUS) {
    it(`drafts corpus case ${item.id} (${item.class}) within the safety contract`, async () => {
      const evidence = selectEvidence(item.candidates, [], TODAY);
      const decision = await draftAnswer({
        provider: requireProvider(),
        questionText: item.question,
        evidence,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      })
        .then((result) => {
          ledger.inputTokens += result.inputTokens;
          ledger.outputTokens += result.outputTokens;
          ledger.calls += 1;
          return result.decision;
        })
        .catch((error: unknown) => {
          ledger.failed += 1;
          throw error;
        });

      // Citation integrity: the model may only cite the retrieved evidence set.
      const evidenceIds = new Set(evidence.map((entry) => entry.sourceId));
      for (const citation of decision.citations) {
        expect(evidenceIds.has(citation.sourceId)).toBe(true);
      }

      // No-evidence questions must abstain deterministically, never fabricate.
      if (item.class === "unsupported") {
        expect(decision.disposition).toBe("insufficient_evidence");
        expect(decision.answerText).toBe("");
        expect(decision.citations).toHaveLength(0);
        expect(decision.strength).toBe("insufficient");
      }

      // Stale-only support may answer for a human, but never looks strong.
      if (item.class === "stale") {
        expect(decision.strength).not.toBe("high");
      }

      // An "answered" decision always carries draft text (the abstention gate
      // forces empty text to insufficient_evidence).
      if (decision.disposition === "answered") {
        expect(decision.answerText.length).toBeGreaterThan(0);
      }

      const tally = answeredByClass.get(item.class) ?? { answered: 0, total: 0 };
      tally.total += 1;
      if (decision.disposition === "answered") {
        tally.answered += 1;
      }
      answeredByClass.set(item.class, tally);

      if (item.expectedSourceId !== null && evidenceIds.has(item.expectedSourceId)) {
        citedExpected.eligible += 1;
        if (decision.citations.some((citation) => citation.sourceId === item.expectedSourceId)) {
          citedExpected.hit += 1;
        }
      }
    }, 60_000);
  }

  it("stays inside the Week 5 budget cap and reports the evaluation summary", () => {
    const estimatedMicroUsd = estimateCostMicroUsd(
      process.env.OPENAI_ANSWER_MODEL ?? "gpt-5.6-luna",
      ledger.inputTokens,
      ledger.outputTokens,
    );

    const classRates = [...answeredByClass.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([className, tally]) => `${className}: ${tally.answered}/${tally.total} answered`)
      .join(" · ");

    // Console (not console.error — these are results, and CI must stay quiet
    // because this file never runs there).
    console.info(
      `[w5-live] calls=${ledger.calls} failed=${ledger.failed} in=${ledger.inputTokens}tok out=${ledger.outputTokens}tok est=$${(estimatedMicroUsd / 1_000_000).toFixed(4)} | ${classRates} | expected-source cited: ${citedExpected.hit}/${citedExpected.eligible}`,
    );

    expect(ledger.calls).toBe(W5_CORPUS.length);
    expect(ledger.failed).toBe(0);
    expect(estimatedMicroUsd).toBeLessThan(W5_BUDGET_MICRO_USD);
  });
});
