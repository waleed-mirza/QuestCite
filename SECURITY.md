# Security policy

WHH Treasures maintains the open-source QuestCite repository. Report a suspected
vulnerability privately to <whhtreasures@gmail.com>. Do not report it with
real customer data, credentials, access links, prompts, answers, or document
content. Remove sensitive material from a report before sending it.

## Reporting

For a self-hosted deployment, publish the operator's monitored security address
and supported reporting channel in the customer contract. Do not open a public
issue for an unfixed vulnerability.

Include a short description, affected version/commit, reproduction steps using
fictional data, impact, and a suggested mitigation. Never include secrets or
signed URLs. The maintainer should acknowledge receipt, validate the report,
coordinate a fix, and publish a sanitized advisory when appropriate.

## Invariants

- Service-role keys, provider tokens, signed URLs, prompts, answers, and raw
  document content stay server-side and out of logs.
- Every tenant-owned table has explicit grants, RLS, and cross-tenant tests.
- Public Trust Center responses are allowlisted and revalidated with Zod.
- Webhooks and long-running mutations are idempotent.
- The public demo is fictional and provider-free; its sample content carries
  `SAMPLE DATA — NOT LEGAL OR COMPLIANCE ADVICE.`
- Production validation rejects demo upload/email mutation bypasses.

## Release check

Before sharing a build or archive:

```bash
pnpm scan:secrets
pnpm audit:release
pnpm release:package
```

Review the diff, generated types, migrations, and package inventory manually as
well. A scanner is a backstop, not a substitute for review.
