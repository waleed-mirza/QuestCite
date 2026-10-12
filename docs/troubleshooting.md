# Troubleshooting

## `pnpm check-env` fails

Read the variable names in the report and compare `.env.local` with
`.env.example`. Values are intentionally never printed. For production, set
`APP_ENV=production`, an HTTPS `NEXT_PUBLIC_APP_URL`, the Supabase values, and
an `AUDIT_HASH_SALT` of at least 32 characters.

## Auth redirects back to login

In Supabase Authentication → URL Configuration, add the deployed origin and
both local callback origins used by the test suite. Confirm the account is
verified before onboarding. See [`authentication.md`](authentication.md) and
[`setup-supabase.md`](setup-supabase.md).

## `demo:seed` reports a slug conflict

The reserved `northstar-cloud` slug already belongs to a tenant without the
expected demo marker. Stop and inspect the organization through an authorized
operator path. Do not delete or overwrite it. Use a separate project or change
the intentionally configured demo slug and its deployment settings.

## Storage or migration errors

Run `pnpm db:migrate:remote`, then `pnpm db:types`. Check that the linked
Supabase project is the intended project and that storage buckets exist. Never
run a reset against a project that contains real data.

## AI drafting is unavailable

Check `AI_ENABLED`, the OpenAI key, the organization kill switch, the selected
plan quota, and the questionnaire state. The public demo is expected to keep
live AI off. Do not add a provider key merely to make a unit, E2E, or CI test
pass.

## E2E or a11y server fails to start

Run `pnpm build` first; the test server uses `pnpm start -p 3100`. Remove only a
stale `.next` build if a local process has locked it, then rerun the build. The
test suite injects fake billing values; it does not need real payment or AI
credentials.

## Release audit fails

Run `pnpm scan:secrets` and `pnpm audit:release` separately. Inspect the listed
file names and the diff. Do not weaken the scanner or add a token-looking test
fixture; replace it with a clearly fake value or a safe hash-only fixture.
