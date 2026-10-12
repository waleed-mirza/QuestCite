# Setting up Supabase (owner runbook)

Status: **live project exists and is linked** (D014, 2026-09-01). This runbook is
kept for reference; new setup steps are CLI-driven. There is NO local database
stack (decision D016 — no Docker): the linked hosted project is the promotion
target for QuestCite production.

## 1. Create a project only if no target exists (browser, ~5 minutes)

The existing linked project is the intended production target. Do not create a
second Supabase project for this release unless the operator later chooses a
separate environment for a specific isolation or compliance requirement.

1. Go to <https://supabase.com> → **Start your project** → sign up (GitHub login works).
2. **New project**:
   - Name: `questcite` (anything you like)
   - Database Password: generate and store it in a password manager — you will need it for backups
   - Region: closest to you (e.g. `eu-central-1` / `ap-south-1`)
   - Plan: **Free**
3. Wait ~2 minutes for provisioning.

## 2. Copy the three keys into `.env.local`

Project page → **Connect** (top bar) → each value below:

| `.env.local` key | Where in Supabase UI |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Connect → Project URL (`https://xxxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Connect → API keys → `anon` / `publishable` |
| `SUPABASE_SERVICE_ROLE_KEY` | Connect → API keys → `service_role` (secret — server only) |

For a local checkout, set `APP_ENV=development` and keep `DEMO_MODE=true`.
Production deployment values are configured separately in the hosting provider;
never copy a production service-role key into a client or commit it.

Then run `pnpm check-env` — the "Supabase not configured" warning must disappear.

## 3. Link the project to this repo (terminal, once)

Requires the Supabase CLI. With pnpm it's run through the pinned wrapper used by
all `db:` scripts — no global install needed:

```bash
pnpm dlx supabase@2.116.0 login        # opens browser, one time
pnpm dlx supabase@2.116.0 link --project-ref <ref>   # ref = the xxxx in your project URL
```

## 4. Daily workflow

```bash
pnpm db:migrate:remote   # pushes pending migrations to the live project
pnpm db:types            # regenerates src/types/database.types.ts (commit the result)
pnpm test:db             # pre-promotion/disposable project only (mutates fixtures)
```

Notes:

- No local stack (D016 — no Docker): `supabase start`, `supabase test db`, and
  Inbucket are not used in this repo. The CLI talks to the linked project via
  the Management API (access token from `supabase login`).
- `supabase db reset --linked` wipes the LIVE database — never run it once real
  data exists.
- The built-in Supabase email service is rate-limited on the free tier.
  Automated tests never depend on it: they mint verification links through the
  service-role admin API (`generateLink`) server-side.

## 4.5 Auth URL configuration (required once; CLI or dashboard)

Verification and recovery links redirect through `/auth/callback`, so the
project must allowlist the origins you test and deploy from. The committed
`supabase/config.toml` stores the production URL plus the local test callbacks.
Apply it to the linked project with:

```bash
supabase config push --project-ref <ref>
```

The same values can be reviewed or changed in the Authentication URL
Configuration dashboard:

- Current hosted Site URL: `https://questcite.netlify.app`
- Current hosted Redirect URLs: `https://questcite.netlify.app/auth/callback`,
  `http://localhost:3000/auth/callback`, and
  `http://localhost:3100/auth/callback` (the Playwright E2E port)
- If a disposable local stack is ever used, override the site URL with
  `http://localhost:3000` in that stack's config; the repository has no local
  Docker stack by design.
- For another production deployment, use that deployment's HTTPS origin and
  `/auth/callback` instead.

The automated auth journey (`tests/e2e/auth-journey.spec.ts`) requires this
allowlist before it can pass.

## 5. Promotion checklist for the existing project

Complete this checklist before accepting real customer data:

1. Export or verify a recoverable backup and record the recovery contact.
2. Confirm the project region, billing/spend limit, database extensions, private
   buckets, RLS policies, and Auth confirmation settings in the dashboard.
3. Run `pnpm dlx supabase@2.116.0 migration list --linked`; local and remote
   histories must match. Apply only reviewed forward migrations with
   `pnpm db:migrate:remote`.
4. Regenerate types with `pnpm db:types` after an intentional schema change and
   inspect the diff.
5. Configure the production Site URL and redirect allowlist from §4.5.
6. Set the hosting provider's production environment to `APP_ENV=production`,
   an HTTPS `NEXT_PUBLIC_APP_URL`, a fresh `AUDIT_HASH_SALT`, and the same
   Supabase URL/keys stored in the operator's secret manager.
7. Freeze `demo:seed`, hosted fixture suites, and any reset/delete workflow
   against this project after promotion. Use a separate disposable project if
   destructive integration testing is ever needed.

The project is promoted by configuration and operational controls; no data is
copied or reset. Keep the pre-promotion backup and record the promotion date.

For an intentional maintainer-hosted public demo, seed the fictional tenant once
before the freeze with the explicit production acknowledgement
`ALLOW_DEMO_SEED_IN_PRODUCTION=true`, then remove that override. The same
one-command acknowledgement (`ALLOW_HOSTED_TEST_MUTATIONS=true`) is required
if the hosted fixture suite must be run during a controlled pre-customer check.
Neither override belongs in a deployed environment.

## 6. Hardening for production deploys

- Set a database spending limit in the Supabase dashboard (Settings → Billing).
- Never use `SUPABASE_SERVICE_ROLE_KEY` in any client component or in a
  hosting provider's public env scope — `check-env` and the secret scanner both
  guard this.

## 7. Week 8 billing migrations

Billing and workspace lifecycle use the forward-only migrations `0030` onward.
After pulling a Week 8 change, run `pnpm db:migrate:remote` followed by
`pnpm db:types`. Configure the billing provider test-mode store and webhook using
the runbook in [`docs/billing.md`](billing.md) before enabling checkout.

---

## Status

The linked Supabase project is the production promotion target. Its local and
remote migration histories were checked through `0034`; rerun the migration-list
check before every deployment. Before accepting customer data, complete the
promotion checklist above, verify the production Auth URL/redirects (the
current values are applied through `supabase config push`), and deploy with
production environment values. Never run `db reset`, `demo:seed`, or
hosted fixture suites against the promoted project.
