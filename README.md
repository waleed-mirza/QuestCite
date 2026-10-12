# QuestCite

QuestCite is a self-hosted Next.js application for turning a team's
approved security evidence into reviewable questionnaire drafts, with inline
citations, a human approval gate, round-trip workbook export, and a public
Trust Center.

The repository includes a fictional Northstar Cloud demo. The signed-out demo
is read-only, provider-free, and safe to run without an account at `/demo`.

## Start in 30 minutes

Requirements: Node 24 LTS, pnpm 10, the linked Supabase project for
authenticated features, and a Netlify or Vercel account only if you want to
deploy.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm check-env
pnpm dev
```

Open <http://localhost:3000>. For a seller demo or a pre-customer verification,
you can provision the fictional Northstar Cloud data in the linked Supabase
project. Configure the three Supabase values in `.env.local`, then run:

```bash
pnpm db:migrate:remote
pnpm db:types
pnpm demo:assets
pnpm demo:seed
pnpm demo:verify
```

The linked project is also this release's production target. Do not run the
seed or any reset/fixture workflow after promotion once customer data is
accepted; the controlled production-demo exception is documented in
[`docs/setup-supabase.md`](docs/setup-supabase.md).

The seed is idempotent and refuses a pre-existing `northstar-cloud` tenant
unless its demo marker matches this repository's seed version. It creates only
fictional content, users, documents, questionnaire results, Trust Center rows,
and safe audit metadata. It never calls OpenAI, sends email, charges a card, or
prints credentials or document content.

## Product tour

- `/demo` — provider-free, read-only Northstar Cloud product tour.
- `/trust/northstar-cloud` — public Trust Center after the demo seed.
- `/login` — authenticated workspace entry point.
- `/app/{orgSlug}` — evidence, questionnaires, review, Trust Center, billing,
  members, notifications, and workspace settings.

The public demo's answer replay is local browser state over stored fixtures. Its
upload, invite, checkout, delete, email, and live-AI actions are visibly
disabled. See [`docs/demo-mode.md`](docs/demo-mode.md).

## Verification commands

Run the smallest relevant checks while working, then the release gate:

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

Database and hosted-provider checks are intentionally separate. Run the hosted
suite only before promoting the linked project or against a disposable project:

```bash
pnpm test:db
pnpm demo:verify
```

`pnpm test:integration` is an alias for the hosted integration/RLS suite.
Live-AI suites are separate and must be enabled deliberately. They spend real
provider credit. Ordinary unit, integration, browser, and demo checks never
call a paid provider.

The linked Supabase project is the production promotion target for this release.
After customer data is accepted, do not run `pnpm test:db`, `pnpm demo:seed`, or
any reset/delete fixture workflow against it. Follow
[`docs/setup-supabase.md`](docs/setup-supabase.md) and
[`docs/deployment.md`](docs/deployment.md) for the freeze and promotion gate.
The commands fail closed under `APP_ENV=production`; a deliberate pre-customer
check or public-demo seed must use a one-command override documented in that
runbook, then remove it.

See [`docs/quickstart.md`](docs/quickstart.md) for the complete first-run
sequence and [`docs/troubleshooting.md`](docs/troubleshooting.md) for safe
failure recovery.

## Documentation map

- [`docs/quickstart.md`](docs/quickstart.md) — clean install and 30-minute path.
- [`docs/setup-supabase.md`](docs/setup-supabase.md) — project, auth, storage,
  migrations, and generated types.
- [`docs/deployment.md`](docs/deployment.md) — Netlify/Vercel, production
  environment, provider setup, and smoke checks.
- [`docs/customization.md`](docs/customization.md) — branding, plans, email,
  prompts, and feature flags.
- [`docs/architecture.md`](docs/architecture.md) — modules, trust boundaries,
  and server/client rules.
- [`docs/data-flow.md`](docs/data-flow.md) — evidence, drafting, review, export,
  and Trust Center flows.
- [`docs/supported-files.md`](docs/supported-files.md) — upload formats and
  hard limits.
- [`docs/database-and-rls.md`](docs/database-and-rls.md) — schema and tenancy
  controls.
- [`docs/billing.md`](docs/billing.md) — billing test mode, quotas, and
  workspace lifecycle.
- [`docs/trust-center.md`](docs/trust-center.md) — public sharing and gated
  downloads.
- [`SECURITY.md`](SECURITY.md) — reporting and security invariants.
- [`SUPPORT.md`](SUPPORT.md) — support policy and issue triage.
- [`LICENSE.md`](LICENSE.md) — MIT License.

## Safe handling

Never commit `.env.local`, provider tokens, signed URLs, raw document content,
questionnaire answers, prompts, or prospect tokens. Run `pnpm scan:secrets`
and `pnpm audit:release` before sharing an archive.

## License and support

QuestCite is released under the [MIT License](LICENSE.md) by WHH Treasures.
The repository does not provide legal, compliance, or security advice. Support
expectations and the security contact are documented in
[`SUPPORT.md`](SUPPORT.md) and [`SECURITY.md`](SECURITY.md).
