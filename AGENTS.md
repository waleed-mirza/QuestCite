<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# QuestCite — agent working rules

These rules are non-negotiable (plan §16). A failing gate blocks the week — it is never deferred to Week 10.

## The 15 rules

1. Read the relevant product requirement, schema, and existing tests before editing.
2. For each behavior change, write or update the test in the same change.
3. Reproduce a bug with a failing test before fixing it.
4. Never delete, skip, loosen, or rewrite a valid test merely to make CI pass.
5. Never use `any`, `@ts-ignore`, unsafe casts, disabled lint rules, or swallowed errors without a documented reason and review.
6. Every public input is validated with Zod or an equivalent database constraint.
7. Every tenant-owned table has explicit grants, RLS policies, and RLS tests before feature completion.
8. Never expose or log secrets, tokens, document content, prompts, answers, or signed URLs.
9. Never import server-only code into a Client Component.
10. Webhooks and long-running mutations must be idempotent.
11. Add loading/empty/success/validation/permission-denied/failure states — not only the happy path.
12. Smallest relevant tests during implementation; full feature gate before marking complete.
13. Inspect diffs, migrations, generated types, and dependency changes before committing.
14. Update docs and fixtures when behavior changes.
15. Do not claim completion without reporting commands run and their results.

## Per-task loop

Understand requirement → identify threats/edge cases → write failing behavior/security test → implement smallest correct slice → run targeted tests → refactor without behavior change → lint + typecheck + affected integration tests → inspect diff + migration → update docs → report evidence.

## Commands

`pnpm lint` · `pnpm typecheck` · `pnpm test:unit` · `pnpm test:coverage` · `pnpm test:e2e` · `pnpm test:a11y` · `pnpm build` (runs `check-env` first) · `pnpm db:types` / `db:migrate:local` / `db:migrate:remote` · `pnpm scan:secrets` · `pnpm audit:release`

`next build` does NOT lint (Next 16) — lint and typecheck run separately in CI and must pass independently.

## Definition of Done (every feature)

Acceptance criteria demonstrated · unit tests (domain rules + failures) · integration tests (DB/storage/provider boundaries) · RLS tests (cross-tenant) when data involved · E2E for critical journeys when UI involved · a11y checks for new interactive UI · error/loading/empty/unauthorized states exist · logs safe (no sensitive content) · docs + `.env.example` updated · lint + typecheck + affected tests + production build pass.

## CI merge policy

Every PR: lockfile validation → lint → strict typecheck → unit + coverage → critical Playwright E2E → a11y smoke → production build → secret scan + release audit. `main` is protected. Small vertical slices only. No merge and no week marked complete while a required gate is red.

## Repo-specific facts

- `memory/`, `trustops-10-week-production-plan.md`, and `assets/sales/` stay out of this public repository. `pnpm audit:release` rejects them if they are force-added.
- Migrations are forward-only; RLS + explicit grants ship in the same migration as each table.
- Node 24 LTS (ADR-001); Next.js is exactly pinned — never canary.
- Never run live-AI tests on CI pushes. A live call spends real OpenAI credit and must be enabled on purpose.
