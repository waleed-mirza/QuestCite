# ADR-005: Test stack and the pure-core testing strategy

- **Status:** Accepted
- **Date:** 2026-09-01
- **Context:** the Week 1 quality protocol for unit, integration, and browser tests

## Decision

- **Vitest 4** for unit/integration tests; **Playwright** for browser e2e + a11y (`@axe-core/playwright`); coverage via `@vitest/coverage-v8` with thresholds (≥80% statements/lines overall on `src/lib`, `src/config`, `src/server`; ≥90–100% on authorization/billing/quota/export cores later per plan).
- Business logic lives in **pure modules** (`src/lib/**`, later `src/server/services/**`) that take inputs and return outputs — no framework imports — so unit tests never boot Next.js.
- Route-level wiring (pages, handlers) is covered by Playwright e2e, not unit tests; generated artifacts (`coverage/`, `test-results/`, `playwright-report/`) are lint-ignored.
- `server-only`/`client-only` bundler-marker packages are aliased to an empty stub in Vitest (they throw by design outside a React Server bundler).
- Playwright always runs against a production build (`pnpm test:e2e` builds first) for determinism.

## Consequences

- Unit suite runs in <1s; no jsdom environment for server logic.
- The `render={<Link/>}` composition pattern means e2e selectors must use the *rendered* element role.
- Visual-regression baselines are deferred until the shells stabilize post-feature-weeks (tests/visual/README.md).
