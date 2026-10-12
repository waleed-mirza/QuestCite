/**
 * Typed application errors for the server layer. Messages are stable codes,
 * never raw provider text — call sites map them to safe user-facing copy and
 * logs stay free of provider internals (plan §16, AGENTS.md rule 8).
 */

export class UnauthorizedError extends Error {
  constructor() {
    super("UNAUTHENTICATED");
    this.name = "UnauthorizedError";
  }
}

/** The resource does not exist *or is not visible to this user* (RLS-empty). */
export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`NOT_FOUND:${resource}`);
    this.name = "NotFoundError";
  }
}

/** Authenticated and able to see the resource, but the role is not enough. */
export class ForbiddenError extends Error {
  constructor() {
    super("FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

/** Input failed validation; message is a stable machine code. */
export class ValidationError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "ValidationError";
  }
}

export function isUnauthorizedError(error: unknown): error is UnauthorizedError {
  return error instanceof UnauthorizedError;
}

export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError;
}

export function isForbiddenError(error: unknown): error is ForbiddenError {
  return error instanceof ForbiddenError;
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}
