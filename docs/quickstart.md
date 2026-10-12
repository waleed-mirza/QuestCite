# QuestCite quickstart

This path takes a new developer from a clean checkout to the fictional demo in
about 30 minutes. The public tour works without Supabase; authenticated
features and the seeded Trust Center use the linked hosted project.

## 0–5 minutes: install

Use Node 24 LTS and pnpm 10. The repository pins the package manager and checks
the Node range during install.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
```

On PowerShell, use `Copy-Item .env.example .env.local`.

## 5–10 minutes: configure local environment

For the signed-out tour, the defaults are enough:

```bash
pnpm check-env
pnpm dev
```

For auth, storage, migrations, and seeding, add these values from the linked
Supabase project to
`.env.local`: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Keep
`SUPABASE_SERVICE_ROLE_KEY` server-only. Follow
[`setup-supabase.md`](setup-supabase.md) for dashboard URL configuration.

## 10–20 minutes: apply the schema and seed the demo

The linked project is the repository's promotion target. During local setup,
run migrations and refresh types before seeding:

```bash
pnpm db:migrate:remote
pnpm db:types
pnpm demo:assets
pnpm demo:seed
pnpm demo:verify
```

`demo:seed` is safe to repeat. It upserts deterministic fictional data and
resets only the deterministic sample questionnaire before recreating its
stored answer run. It refuses a slug collision unless the existing tenant is
already marked as this demo version.

Do not run `demo:seed` or hosted fixture suites after the project is promoted
and customer data is accepted. Freeze those commands or use a disposable
Supabase project for destructive integration testing.

## 20–30 minutes: inspect the product

1. Open `/demo` and replay the stored answer run.
2. Open `/trust/northstar-cloud` and inspect the public allowlisted view.
3. Create a test account at `/signup`, verify it through the configured auth
   flow, and create a non-demo workspace.
4. Upload a safe fixture, map it, draft answers only when AI is intentionally
   configured, review, and export.

The demo does not send data to OpenAI. Production provider setup is covered in
[`deployment.md`](deployment.md), while file constraints are in
[`supported-files.md`](supported-files.md).

## Before opening a pull request

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:coverage
pnpm test:e2e
pnpm test:a11y
pnpm test:visual
pnpm test:matrix
pnpm test:ai:offline
pnpm build
pnpm scan:secrets
pnpm audit:release
pnpm check:docs
```

Use `pnpm test:db` only before the linked project is promoted or against a
disposable project; it is blocked by default under `APP_ENV=production`. Do not
run live-AI tests in CI or spend provider credit for ordinary test runs.
