# Trust Center

Week 7 adds a public, branded Trust Center with controlled document sharing.
The public surface is deliberately smaller than the authenticated editor: it
is built from one allowlisted database function and a server-side Zod schema.

## Routes

| Route | Purpose | Access |
|---|---|---|
| `/app/{orgSlug}/trust-center` | Edit branding, public slug, clickwrap terms, FAQs, certifications, subprocessors, document cards, and status | Owner/Admin |
| `/app/{orgSlug}/access-requests` | Review, approve, deny, and revoke grants | Owner/Admin |
| `/trust/{slug}` | Published public Trust Center | Anonymous or signed-in visitor |
| `/trust/{slug}/request` | Request one or more public document cards | Anonymous |
| `/trust/{slug}/verify/{token}` | Confirm an email when the center requires it | Anonymous with a signed verification link |
| `/trust/{slug}/access/{token}` | View currently granted documents and accept changed terms | Anonymous with a signed access link |
| `/api/trust/{slug}/documents/{documentId}/download` | Authorize a single download and redirect to private storage | Anonymous with a valid access link |

Changing the public slug is owner/admin-only, validates the same lowercase
slug rules as workspaces, rejects reserved and duplicate values, and writes an
audit event. The old public address is no longer valid after the change.

## Publishing

Trust Centers move through `draft`, `preview`, and `published` states. Only
`published` centers are visible through the public RPC. Publishing is checked
again in PostgreSQL and requires a display name, headline, security overview,
contact email, terms version, and terms text. Preview is an internal member
state; it is not a public preview URL.

Document cards have an independent `publicly_requestable` switch. A card is
publicly listed or grantable only when all of these are true:

- the card belongs to the same organization as the referenced document;
- requestability is enabled;
- the document is `active`; and
- at least one document version is `ready`.

The editor still shows hidden, archived, and unprocessed cards so an owner can
correct them. The public page never receives their internal state, storage
path, owner, checksum, or processing metadata.

## Request and confirmation flow

The request form validates name, company, work email, selected document IDs,
and clickwrap acceptance in the browser and again in the database. The
database records the exact current terms version and SHA-256 terms hash in
`nda_acceptances`; the browser cannot supply either value.

Requests are atomically limited to 5 per IP hash per hour and 20 per Trust
Center per hour. Raw IP addresses are never stored: the app sends a salted
SHA-256 hash and a coarse user-agent bucket.

When email confirmation is disabled, a valid request enters `pending_review`.
When it is enabled, the request starts as `submitted`. The app creates a
24-hour HMAC confirmation link and passes it to the email abstraction; the
database only performs the idempotent `submitted` → `pending_review` flip
after the HMAC is verified. Development uses the existing log-mode email
transport, which records only the template key and request ID—not the address,
message body, or link. W8 adds optional Resend delivery; log mode remains the
safe default until a deployer configures the provider.

## Approval and downloads

Only owners and admins can review a request. Approval selects a subset of the
requested documents and a 1–30 day grant period. PostgreSQL validates the
subset and current document readiness, creates one grant per document, and
returns a 64-hex prospect token exactly once. Only its SHA-256 hash is stored.

The owner-facing action shows the one-time link so it can be copied before the
queue is refreshed. Approval/denial also passes through the log-safe prospect
email abstraction. A grant is bound to its request, organization, and
document; revocation and lazy expiry take effect immediately.

The download API performs the full token, center, grant, document, ready
version, and current-terms checks in the database. It records a
`download_events` row, then issues a 60-second signed URL for the private
`documents` bucket. Wrong documents, wrong organizations, invalid links,
expired grants, and unavailable versions receive generic safe errors.

## Security and test coverage

Anonymous callers have no table `SELECT` grants on Trust Center tables. Public
reads use `get_trust_center_overview(slug)` and are revalidated by
`publicTrustCenterSchema`. Tenant tables ship with explicit grants, RLS, and
cross-tenant tests in the same migration history. Direct lifecycle writes are
blocked by column-level grants; document-card references are checked by both
RLS and a database trigger.

The W7 checks are covered by:

- `tests/unit/services/trust-public-allowlist.test.ts`
- `tests/unit/lib/trust-center-validation.test.ts`
- `tests/unit/lib/trust-verify-token.test.ts`
- `tests/integration/rls.trust-center.test.ts`
- `tests/e2e/trust-journey.spec.ts`

Run the focused checks with:

```text
pnpm exec vitest run tests/unit/services/trust-public-allowlist.test.ts tests/unit/lib/trust-center-validation.test.ts tests/unit/lib/trust-verify-token.test.ts
pnpm test:db tests/integration/rls.trust-center.test.ts
E2E_AUTH_JOURNEY=1 pnpm exec playwright test tests/e2e/trust-journey.spec.ts --project=e2e
```

These hosted commands mutate fixtures. Run them before promotion or against a
disposable project; the production guard requires an explicit
`ALLOW_HOSTED_TEST_MUTATIONS=true` acknowledgement once `APP_ENV=production`.

No new environment variables are required for W7. Keep real provider keys in
the local environment only; never put them in `.env.example`, fixtures, or
logs.
