# Deployment guide

QuestCite deploys as a Next.js App Router application. The current public
demo host is Netlify at <https://questcite.netlify.app/>; Vercel remains
compatible as an alternative host. Supabase is the reference database, auth,
storage, and Postgres RPC provider.

## 1. Promote the linked Supabase project

QuestCite uses the already-linked Supabase project as the production target;
this release does not require a second development project. Promotion is an
operational change, not a database reset:

1. Verify a recoverable backup, region, spend limit, private buckets, RLS
   policies, and Auth confirmation settings in the Supabase dashboard.
2. From a reviewed checkout, run
   `pnpm dlx supabase@2.116.0 migration list --linked`; local and remote
   histories must match. Apply only reviewed forward migrations with
   `pnpm db:migrate:remote`.
3. Regenerate and inspect types only after an intentional schema change:
   `pnpm db:types`.
4. Apply the HTTPS production Site URL and `/auth/callback` redirect URL with
   `supabase config push --project-ref <ref>` from the committed config, or
   set the same values in the Authentication URL Configuration dashboard.
5. Freeze `demo:seed`, hosted fixture suites, and reset/delete workflows against
   this project after promotion. Use a disposable project for destructive tests.
6. Keep database backups and the recovery contact under the operator's control.

The complete project setup and storage policy notes are in
[`setup-supabase.md`](setup-supabase.md). Never run a linked database reset on
a project containing customer data.

## 2. Configure Netlify production environment variables

Set the variables from the local, ignored `.env.prod` template in Netlify:
**Project configuration → Environment variables → Production**. The minimum
production set is:

```text
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_APP_NAME
APP_ENV=production
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
AUDIT_HASH_SALT
```

For a customer deployment, also set `DEMO_MODE=false`,
`LIVE_DEMO_AI_ENABLED=false`, `DEMO_UPLOADS_ENABLED=false`, and
`DEMO_EMAILS_ENABLED=false`. Configure `AI_ENABLED` and its OpenAI key only if
the operator has approved live AI use. Lemon Squeezy billing is optional; if
you enable it, keep test mode on until the webhook has been verified.

`pnpm build` runs `pnpm check-env` first. Production boot fails on missing
required values or dangerous demo mutation flags. Validation errors list
variable names only.

After saving the variables, trigger a production deploy and check
`https://questcite.netlify.app/`, `/login`, `/demo`, and
`/trust/northstar-cloud`. The Netlify site will not contain the QuestCite
rebrand until the committed tree is pushed and a new deploy completes.

### CI and the shared project

Leave `RUN_HOSTED_DB_TESTS` and `RUN_HOSTED_E2E` unset (or false) for normal
pull requests and pushes. The public smoke/a11y jobs need no database writes.
If a controlled hosted fixture run is required, use a disposable project where
possible; otherwise set the corresponding repository variable and provide the
short-lived `ALLOW_HOSTED_TEST_MUTATIONS=true` secret for that run, then revoke
the secret. The linked production project must never be a default CI fixture
target.

## 3. Configure providers deliberately

- OpenAI: set `OPENAI_API_KEY`, model names, and a budget alert. The app stores
  safe usage totals, never prompts or answers.
- Resend: optional. An operator that needs transactional email sets
  `EMAIL_DELIVERY_MODE=resend`, `RESEND_API_KEY`, and `EMAIL_FROM` in its own
  deployment. The public demo stays in `log` mode and requires no Resend account.
- Workspace billing: optional. Omit every `LEMON_SQUEEZY_*` variable unless this
  deployment sells Starter/Pro/Agency plans to its own customers. The app builds
  and runs without them; the public demo leaves them unset.
- Supabase: keep the service-role key in the server environment only; it is
  never a public `NEXT_PUBLIC_` value.

## 4. Deploy and smoke test

After the first deploy:

```bash
pnpm check-env
pnpm audit:release
```

Then check the deployed landing page, `/login`, `/demo`, the public Trust
Center, a denied unauthenticated `/app/...` request, and the webhook endpoint's
signature rejection path. Do not run `pnpm test:db` after promotion because its
fixtures mutate the shared project; run it only before the freeze or against a
disposable project.

## 5. Demo deployment versus customer deployment

The public demo may keep `DEMO_MODE=true`, but it must retain the
provider-free defaults and fictional `northstar-cloud` tenant. An operator
should use a new `DEMO_ORG_SLUG` only if it is intentionally running a separate
demo, and must disable the public demo before handling real data.
See [`demo-mode.md`](demo-mode.md) and [`SECURITY.md`](../SECURITY.md).

For the public demo host, keep `AI_ENABLED=false` and leave
`OPENAI_API_KEY` unset. The public `/demo` route is a local fixture replay and
does not need an OpenAI credential. Never put a personal OpenAI key in a public
deployment. If live AI is intentionally enabled for a controlled
deployment, create a separate OpenAI project/key, restrict the allowed models
and rate limits, and configure an enforced project spend limit before adding
the key to Netlify.
