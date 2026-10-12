# Demo mode and Northstar Cloud

The repository ships a fictional Northstar Cloud tenant so a buyer can inspect
the core workflow without supplying documents, prompts, provider keys, or an
account. Every fixture carries the exact disclaimer:

> SAMPLE DATA — NOT LEGAL OR COMPLIANCE ADVICE.

## Runtime behavior

The public `/demo` route is a Client Component over a client-safe fixture. It
does not import Supabase, provider SDKs, server-only modules, or server actions.
Its answer replay uses four timed local stages and the pre-generated fixture.
Editing a displayed answer is simulated state and resets on refresh.

These actions are intentionally disabled in the public tour:

- uploads and document mutation;
- teammate invitations;
- checkout and billing changes;
- workspace deletion;
- email delivery;
- live AI calls.

The environment defaults are `DEMO_MODE=true`, `LIVE_DEMO_AI_ENABLED=false`,
`DEMO_UPLOADS_ENABLED=false`, `DEMO_EMAILS_ENABLED=false`, and a maximum of
five optional live-demo questions. Production validation rejects the dangerous
upload/email flags and rejects live demo AI without demo mode and a key.

## Seed workflow

The seed requires the Supabase URL, anon key, and service-role key in the local
environment. It creates or converges the reserved tenant, three fictional
members, seven policy documents, ten approved Q&A entries, one 40-question
assessment, 32 grounded drafts, six `needs_review` drafts, two
`insufficient_evidence` abstentions, one stored completed run, a published
Trust Center, two access requests, and safe audit metadata.

```bash
pnpm demo:assets
pnpm demo:seed
pnpm demo:verify
```

The seed is idempotent. It uses deterministic IDs, upserts documents and public
content, and resets only the deterministic sample questionnaire before
rebuilding its dependent answers and run. It will fail with a safe slug-conflict
code if `northstar-cloud` belongs to a non-demo tenant. It never prints auth
emails, passwords, tokens, document text, or answer text.

## Kill switches and customization

Use the global `AI_ENABLED` switch and per-organization `ai_drafts_disabled`
switch for real workspaces. Keep public demo provider operations disabled even
when production AI is configured; the seller/demo deployment should leave
`AI_ENABLED=false` and `OPENAI_API_KEY` unset. Never use a personal OpenAI key
on a public seller site. For a deliberate live-AI deployment, isolate the key
in a separate provider project with model/rate restrictions and an enforced
spend limit. For branding and plan changes, follow
[`customization.md`](customization.md); for customer deployment, follow
[`deployment.md`](deployment.md).
