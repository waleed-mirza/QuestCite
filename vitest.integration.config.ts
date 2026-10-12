import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Integration config for the hosted-database suite (D016 — no Docker).
 *
 * Kept separate from vitest.config.ts so `pnpm test:unit` / `test:coverage`
 * never touch the live project. Tests provision their own fixtures through the
 * service-role admin API (server-side only) and clean up after themselves.
 *
 * Run: pnpm test:db
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/stubs/empty-module.ts"),
      "client-only": path.resolve(__dirname, "tests/stubs/empty-module.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // One shared worker, one file at a time against the shared hosted
    // database.
    fileParallelism: false,
    isolate: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
