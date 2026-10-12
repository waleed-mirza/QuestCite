# Migrations

Forward-only SQL migrations, applied in filename order.

## Convention

- Name: `NNNN_short_description.sql` (`0001_profiles_orgs_rls.sql`), NNNN strictly increasing, never reused after a revert.
- One logical change per migration; each migration must be idempotent-safe to APPLY ONCE (never edited after being applied anywhere).
- Every tenant-owned table ships in the SAME migration as: explicit `grant` statements, `enable row level security`, and its policies (AGENTS.md rule 7).
- Never use `security definer` functions to bypass RLS without a documented ADR.
- Down-migrations do not exist — roll forward.

## Workflow

```bash
pnpm db:migrate:remote   # push reviewed pending migrations to the linked live project
pnpm db:types            # regenerate src/types/database.types.ts from the linked project
pnpm test:db             # run only before promotion or against a disposable project
```

No local database exists (decision D016 — no Docker): the linked hosted project is
the QuestCite production promotion target. `supabase db reset --linked` would
wipe it and is off-limits while real data exists. Freeze `pnpm test:db`,
`pnpm demo:seed`, and other fixture workflows after customer data is accepted;
use a disposable project for destructive tests. `supabase/tests/` was removed in
Week 2 — DB tests are Vitest integration suites in `tests/integration/`.

Week 1 contained no schema — `0001` (Week 2) is the first migration.
