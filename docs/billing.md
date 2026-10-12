# Billing, quotas, and workspace lifecycle

Week 8 uses a hosted checkout provider. Supabase is the source
of truth for the effective plan and usage limits. A checkout redirect never
changes entitlements; the signed webhook route is the only subscription write
boundary.

This adapter is **in-app workspace billing** (Starter / Pro / Agency
subscriptions inside a self-hosted copy). The QuestCite source itself is MIT
licensed and is not sold here. The public demo omits `LEMON_SQUEEZY_API_KEY`,
store ID, webhook secret, and variant IDs entirely.

## Test mode setup

1. Create test-mode products and variants in the billing provider.
2. Uncomment the `LEMON_SQUEEZY_*` keys in `.env.example`, copy them into
   `.env.local`, and fill the test store ID, webhook signing secret, and
   numeric variant IDs.
3. Keep `LEMON_SQUEEZY_TEST_MODE=true` while testing. Configure the webhook URL
   as `https://<deployment>/api/webhooks/lemonsqueezy`.
4. Push the schema and refresh generated types:

   ```bash
   pnpm db:migrate:remote
   pnpm db:types
   ```

The checkout API additionally needs `LEMON_SQUEEZY_API_KEY`. Until that key is
configured, the billing page displays a safe “not configured” checkout error
without making an external call.

For a signed local fixture, use a real test workspace UUID and the test-mode
secret. The command prints a JSON body followed by the `X-Signature` header;
the secret itself is never printed:

```bash
pnpm billing:webhook-fixture -- --org-id <workspace-uuid>
pnpm billing:webhook-fixture -- --org-id <workspace-uuid> --event subscription_payment_failed --status failed
```

## Provider contract

The provider sends the raw request body and an `X-Signature` HMAC-SHA256 value.
The route verifies the raw bytes before parsing, validates the event shape with
Zod, maps the server-owned variant ID to a local plan, and forwards only
normalized fields to the service-role transaction boundary. Subscription
events are stored in an inbox keyed by provider event ID and body hash, so
replays are harmless and older events cannot roll a subscription backward.

The route handles subscription created/updated/plan-changed/cancelled/resumed/
expired/paused/unpaused plus payment success/failed/recovered events. Payment
failure falls back to the local free entitlement until a recovered/active event
arrives. A cancellation keeps the paid plan until its provider `ends_at` date;
expired, paused, past-due, or ended subscriptions resolve to `free`.

## Entitlements

| Plan | AI drafts/month | Questionnaires/month | Documents | Members |
|---|---:|---:|---:|---:|
| Free | 0 | 1 | 3 | 3 |
| Trial | 25 | 1 | 5 | 3 |
| Starter | 250 | 10 | 25 | 10 |
| Pro | 1,500 | 50 | 100 | 50 |
| Agency | 5,000 | 200 | 500 | 200 |

New workspaces begin on the local `trial` onboarding plan. The Trial AI
allowance is monthly and resets at the UTC month boundary. Existing workspaces
without a subscription retain that onboarding trial behavior for compatibility;
an inactive paid subscription resolves to `free`.

Usage counters are updated atomically in Postgres. Inserts for documents,
questionnaires, members, and AI run items are guarded by database triggers, and
the public `consume_usage` RPC locks the workspace while checking the plan.
The first request larger than the remaining limit is denied as well.

## Email delivery

`EMAIL_DELIVERY_MODE=log` is the safe default. It records only a template key
and internal recipient/request identifiers. It never logs email addresses,
subjects, bodies, invitation/access tokens, prompts, answers, or signed URLs.

Resend is optional. An operator that wants actual delivery
sets `EMAIL_DELIVERY_MODE=resend`, `RESEND_API_KEY`, and `EMAIL_FROM` in its own
deployment and provider account. Provider failures return a safe result and
never expose Resend's response body. Templates cover member invitations,
questionnaire assignment, review reminders, review/access-request outcomes,
and Trust Center access verification/approval/denial.

## Workspace settings

Owners and admins can set operational retention from 30 to 3,650 days and
disable new AI drafting for the workspace. Retention maintenance prunes only
operational notifications, download events, audit history, and billing inbox
history; it does not silently delete documents, questionnaire content, or
answers.

Owners can download a metadata-only JSON export containing workspace details and
counts. It deliberately excludes document/questionnaire text, answers, prompts,
and storage paths. Permanent deletion requires an exact slug confirmation and a
separate deletion request; database rows cascade, and stored files are cleaned
up without exposing their paths.

## Platform health

Emails listed in `PLATFORM_ADMIN_EMAILS` can open `/admin`. The view contains
only organization, subscription, and answer-job status aggregates. It does not
query or render document bytes, questionnaire questions, answers, prompts, or
storage paths.
