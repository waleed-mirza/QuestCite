import "server-only";

/**
 * Safe structured logger (plan §6 "observability"): JSON lines, level filtering,
 * and deny-list redaction so a careless call site cannot leak credentials,
 * tokens, document content, prompts, or signed URLs into logs.
 *
 * The deny-list is shallow-key based and depth-bounded; it is defense in depth,
 * NOT permission to log sensitive values — call sites must still never pass them.
 */

const REDACTED = "[REDACTED]";
const MAX_REDACTION_DEPTH = 4;

/**
 * Deliberately blunt: a key like `documents` or `answers` is redacted in full
 * when its value could carry content (string/object/array). Numbers and
 * booleans cannot leak content, so safe metadata like `documentCount: 3`
 * survives — but redaction is never permission to put sensitive VALUES under
 * keys outside this list.
 */
const SENSITIVE_KEY_PATTERN = /(secret|token|password|passwd|api[_-]?key|authorization|cookie|session|salt|private|content|prompt|answer|document|body)/i;

type JsonObject = { [key: string]: JsonValue | undefined };
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export type LogContext = JsonObject;

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function redact(value: JsonValue | undefined, depth: number): JsonValue | undefined {
  if (value === undefined || depth > MAX_REDACTION_DEPTH) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1) ?? null);
  }
  if (value !== null && typeof value === "object") {
    const scrubbed: { [key: string]: JsonValue | undefined } = {};
    for (const [key, nested] of Object.entries(value)) {
      const couldCarryContent = nested !== undefined && typeof nested !== "number" && typeof nested !== "boolean";
      scrubbed[key] = SENSITIVE_KEY_PATTERN.test(key) && couldCarryContent ? REDACTED : redact(nested, depth + 1);
    }
    return scrubbed;
  }
  return value;
}

function write(level: LogLevel, message: string, context: LogContext | undefined): void {
  const minLevel: LogLevel = process.env.LOG_LEVEL === "debug" || process.env.NODE_ENV !== "production" ? "debug" : "info";
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) {
    return;
  }

  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...(context !== undefined ? { context: redact(context, 0) } : {}),
  };

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};
