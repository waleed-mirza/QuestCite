# Contributing

Keep changes small and vertical. Read the relevant requirement, schema, and
existing tests first. For each behavior change, add or update the test in the
same change; reproduce a bug with a failing test before fixing it.

## Local loop

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:coverage
pnpm build
pnpm scan:secrets
pnpm audit:release
pnpm check:docs
```

Use `pnpm test:db` only before the linked project is promoted or against a
disposable project; it is blocked by default under `APP_ENV=production`. Never
run live AI tests in CI. A live call spends real provider credit and must be
enabled on purpose.

## Review requirements

Inspect diffs, migrations, generated types, dependency changes, fixtures, and
release inventory. New interactive UI needs loading, empty, success,
validation, permission-denied, and failure states plus an a11y smoke test.
Tenant data needs grants, RLS, and cross-tenant tests. Keep logs free of
secrets, tokens, document content, prompts, and answers.
