# Customization guide

Keep customizations small and explicit. The application has separate config
surfaces for public branding, product entitlements, provider delivery, and the
AI contract.

## Branding

- Set `NEXT_PUBLIC_APP_NAME` and `NEXT_PUBLIC_APP_URL` in the environment.
- Update the marketing copy in `src/app/(marketing)/page.tsx`.
- Update the default metadata in `src/app/layout.tsx` and the code-native
  Open Graph card in `src/app/opengraph-image.tsx`.
- Customize a customer's Trust Center through the authenticated editor, not by
  editing the public RPC response.

Keep public Trust Center data allowlisted in
`src/server/services/trust-public.ts`. Never add storage paths, owner IDs,
checksums, private notes, prompts, answers, or tokens to that contract.

## Plans and quotas

Product entitlements live in `src/config/plans.ts` and the authoritative plan
rows live in the billing migration. If a limit changes, update the user-facing
copy, database seed/fixtures, and quota tests together. Do not raise a hard
database ceiling from a UI-only change.

Starter/Pro/Agency checkout uses the server `LEMON_SQUEEZY_*` keys from
[`billing.md`](billing.md). Leave those keys unset when checkout is disabled.

## Email

Keep `EMAIL_DELIVERY_MODE=log` for local and public-demo work. Resend is an
optional integration each operator configures and pays for. An operator that
enables it sets `RESEND_API_KEY`, `EMAIL_FROM`, and optionally
`EMAIL_REPLY_TO` in its own deployment. Templates are in `src/lib/email`; the
logger records template keys and safe internal identifiers only. Do not add
addresses, bodies, prompts, answers, or signed links to logs.

## AI prompts and models

Model names and token ceilings are environment values. Prompt versions are
stamped on answer runs. Changes to the structured output contract must update
the Zod schema, drafting tests, evaluation fixtures, and safe failure mapping.
AI can draft or abstain; it cannot approve an answer. Check
[`billing.md`](billing.md) before any live call. A live call spends real
provider credit.

## Feature flags

Server-only flags are in `src/config/feature-flags.ts` and validated through
`src/lib/validation/env-schema.ts`. Client-safe UI constants belong in a
client-safe module such as `src/features/demo/data.ts`. Never import the
server environment accessor or service-role client into a Client Component.

## After a customization

Run the focused unit tests, then `pnpm lint`, `pnpm typecheck`, `pnpm build`,
`pnpm scan:secrets`, `pnpm audit:release`, and the relevant E2E/a11y suites.
Update the relevant docs and fixtures in the same change.
