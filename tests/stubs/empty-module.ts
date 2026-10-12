/**
 * Test-only stub for the `server-only` / `client-only` guard packages.
 * The real packages exist purely as bundler markers (they throw at import
 * time); Vitest has no React Server bundler, so unit tests alias them here.
 */
export {};
