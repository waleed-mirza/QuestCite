import "server-only";

import { getServerEnv } from "@/lib/env";
import { MODEL_OUTPUT_JSON_SCHEMA } from "@/lib/validation/drafting";

/**
 * Answer-provider adapter (plan §6/§10). The interface is the seam that keeps
 * the drafting service provider-agnostic and fully testable offline: tests
 * inject a fake, buyers can swap vendors, and only this module knows OpenAI's
 * wire format.
 *
 * Data handling (plan §10): requests go through the Responses API with
 * `store: false`; Structured Outputs force the model contract; max output
 * tokens are capped per call (cost control). Error text from the provider can
 * echo prompt fragments, so failures surface as stable uppercase codes only.
 */

export interface AnswerProvider {
  /**
   * Produces one draft decision as JSON matching MODEL_OUTPUT_JSON_SCHEMA.
   * Implementations MUST enforce the schema provider-side (Structured
   * Outputs) — callers still re-validate (defense in depth).
   */
  complete(request: { system: string; user: string; maxOutputTokens: number }): Promise<ProviderCompletion>;
}

export type ProviderCompletion = {
  /** Raw JSON text of the structured output. */
  json: string;
  inputTokens: number;
  outputTokens: number;
};

export type AnswerProviderErrorCode =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_FAILED"
  | "PROVIDER_RESPONSE_INVALID";

export class AnswerProviderError extends Error {
  readonly code: AnswerProviderErrorCode;

  constructor(code: AnswerProviderErrorCode) {
    super(code);
    this.name = "AnswerProviderError";
    this.code = code;
  }
}

export type AnswerAvailability = "ready" | "disabled" | "not_configured";

export function getAnswerAvailability(): AnswerAvailability {
  const env = getServerEnv();
  if (!env.AI_ENABLED) {
    return "disabled";
  }
  return env.OPENAI_API_KEY === undefined ? "not_configured" : "ready";
}

export class OpenAIAnswerProvider implements AnswerProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    apiKey: string,
    model: string,
    options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async complete(request: { system: string; user: string; maxOutputTokens: number }): Promise<ProviderCompletion> {
    let response: Response;
    try {
      response = await this.fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: this.model,
          store: false,
          input: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "draft_answer",
              strict: true,
              schema: MODEL_OUTPUT_JSON_SCHEMA,
            },
          },
          max_output_tokens: request.maxOutputTokens,
        }),
      });
    } catch {
      // Network failure or timeout — provider bodies are never read on error.
      throw new AnswerProviderError("PROVIDER_TIMEOUT");
    }

    if (!response.ok) {
      // Status only; the response body may echo input text and is discarded.
      throw new AnswerProviderError("PROVIDER_FAILED");
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new AnswerProviderError("PROVIDER_RESPONSE_INVALID");
    }

    const json = extractText(parsed);
    if (json === null) {
      throw new AnswerProviderError("PROVIDER_RESPONSE_INVALID");
    }

    const inputTokens = readUsageField(parsed, "input_tokens");
    const outputTokens = readUsageField(parsed, "output_tokens");
    if (inputTokens === null || outputTokens === null) {
      throw new AnswerProviderError("PROVIDER_RESPONSE_INVALID");
    }

    return { json, inputTokens, outputTokens };
  }
}

/** Returns the configured server-side answer provider, never a client value. */
export function getAnswerProvider(): AnswerProvider | null {
  const env = getServerEnv();
  if (!env.AI_ENABLED || env.OPENAI_API_KEY === undefined) {
    return null;
  }
  return new OpenAIAnswerProvider(env.OPENAI_API_KEY, env.OPENAI_ANSWER_MODEL, { timeoutMs: 20_000 });
}

function extractText(parsed: unknown): string | null {
  if (!isRecord(parsed)) {
    return null;
  }
  if (typeof parsed.output_text === "string" && parsed.output_text.length > 0) {
    return parsed.output_text;
  }
  for (const item of Array.isArray(parsed.output) ? parsed.output : []) {
    if (!isRecord(item)) continue;
    for (const part of Array.isArray(item.content) ? item.content : []) {
      if (!isRecord(part)) continue;
      if (part.type === "output_text" && typeof part.text === "string" && part.text.length > 0) {
        return part.text;
      }
    }
  }
  return null;
}

function readUsageField(parsed: unknown, field: "input_tokens" | "output_tokens"): number | null {
  if (!isRecord(parsed) || !isRecord(parsed.usage)) {
    return null;
  }
  return readUsage(parsed.usage[field]);
}

function readUsage(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Estimated model-call cost in micro-USD. The rate table lives in the app so a
 * correction never needs a migration; the database stores only the non-negative
 * total.
 */
const PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
};
const FALLBACK_PRICING = { input: 0.2, output: 1.2 };

export function estimateCostMicroUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING_PER_MILLION[model] ?? FALLBACK_PRICING;
  const inputMicro = (inputTokens / 1_000_000) * pricing.input * 1_000_000;
  const outputMicro = (outputTokens / 1_000_000) * pricing.output * 1_000_000;
  return Math.round(inputMicro + outputMicro);
}
