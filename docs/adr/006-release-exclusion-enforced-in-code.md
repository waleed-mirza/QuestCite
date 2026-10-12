# ADR-006: Release exclusions enforced in code, not convention

- **Status:** Accepted
- **Date:** 2026-09-01
- **Context:** private notes and sales copy must not ship in a release archive

## Decision

A release ZIP is built through a **code-defined packaging transform**:

- `src/lib/security/release-inventory.ts` exports `FORBIDDEN_RELEASE_PATHS` (`memory/`, `trustops-10-week-production-plan.md`, `assets/sales/`) and `filterReleaseFiles()`, which drops them.
- `pnpm audit:release` (CI gate) simulates the packaging on the actual tracked file list and fails if any forbidden path, stray `.env*` file, or non-fake fixture value would ship.
- The ZIP builder must call `filterReleaseFiles()` — the audit proves the rule, the builder applies it.

## Context

Those paths are gitignored in the public repository. The packaging rule remains so a force-add cannot put them in a release archive.

## Consequences

- Adding a new private artifact class means adding it to `FORBIDDEN_RELEASE_PATHS` (one place, tested).
- CI fails loudly the moment a new `.env.local`-style file or real secret shape enters the tree — before any release is attempted.
