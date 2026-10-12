import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/observability/logger";

/**
 * The logger is safe-output infrastructure: these tests pin the redaction
 * contract from plan §16 rule 8 (never log secrets/tokens/document content/
 * prompts/answers) so call sites cannot regress it silently.
 */

let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function lastLoggedLine(): Record<string, unknown> {
  const calls = stdoutSpy.mock.calls;
  const last = calls[calls.length - 1];
  expect(last).toBeDefined();
  return JSON.parse(String(last[0])) as Record<string, unknown>;
}

describe("logger redaction", () => {
  it("emits structured JSON with time, level, and message", () => {
    logger.info("app.started", { port: 3000 });
    const line = lastLoggedLine();
    expect(line.level).toBe("info");
    expect(line.message).toBe("app.started");
    expect(typeof line.time).toBe("string");
    expect(line.context).toEqual({ port: 3000 });
  });

  it("redacts deny-listed keys at the top level", () => {
    logger.info("auth.login", { userId: "u_1", token: "secret-value", apiKey: "sk-value" });
    const line = lastLoggedLine();
    const context = line.context as Record<string, unknown>;
    expect(context.userId).toBe("u_1");
    expect(context.token).toBe("[REDACTED]");
    expect(context.apiKey).toBe("[REDACTED]");
  });

  it("redacts nested and array-carried secrets under neutral keys", () => {
    logger.info("files.processed", {
      files: [{ name: "soc2.docx", content: "full text" }],
      providers: [{ name: "openai", apiKey: "sk-value" }],
    });
    const line = lastLoggedLine();
    const context = line.context as { files: Array<Record<string, unknown>>; providers: Array<Record<string, unknown>> };
    expect(context.files[0]?.name).toBe("soc2.docx");
    expect(context.files[0]?.content).toBe("[REDACTED]");
    expect(context.providers[0]?.apiKey).toBe("[REDACTED]");
  });

  it("redacts blunt-listed keys wholesale, even when holding metadata", () => {
    logger.info("import.finished", { documents: [{ name: "soc2.docx" }], documentCount: 3 });
    const line = lastLoggedLine();
    const context = line.context as Record<string, unknown>;
    expect(context.documents).toBe("[REDACTED]");
    expect(context.documentCount).toBe(3);
  });

  it("redacts prompt and answer fields", () => {
    logger.debug("ai.draft", { prompt: "Answer question 1", answer: "We use AES-256" });
    const line = lastLoggedLine();
    const context = line.context as Record<string, unknown>;
    expect(context.prompt).toBe("[REDACTED]");
    expect(context.answer).toBe("[REDACTED]");
  });

  it("does not redact benign operational fields", () => {
    logger.info("import.rows", { questionnaireId: "q_1", rowCount: 40, invalidCount: 2 });
    const line = lastLoggedLine();
    expect(line.context).toEqual({ questionnaireId: "q_1", rowCount: 40, invalidCount: 2 });
  });

  it("preserves level ordering: debug suppressed in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      logger.debug("should.not.appear");
      logger.error("should.appear");
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(vi.spyOn(console, "error")).toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("writes warnings through console.warn and errors through console.error", () => {
    logger.warn("w");
    logger.error("e");
    expect(vi.spyOn(console, "warn")).toHaveBeenCalledOnce();
    expect(vi.spyOn(console, "error")).toHaveBeenCalledOnce();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
