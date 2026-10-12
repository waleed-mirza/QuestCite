# Authentication (Week 2)

Supabase Auth (email + password) through `@supabase/ssr`. Google OAuth stays
disabled (PRD §3); roles never live in user metadata or JWT claims (plan §7).

## Session pattern (plan §7)

1. Separate browser (`src/lib/supabase/browser.ts`) and server
   (`src/lib/supabase/server.ts`) clients from `@supabase/ssr`.
2. `src/proxy.ts` (Next 16's replacement for `middleware.ts`) refreshes tokens
   once per navigation and makes optimistic redirects only. Rotated cookies
   are stamped on every possible response, including redirects.
3. Verified identity always comes from `getClaims()`
   (`src/server/auth/session.ts`) — never from an unverified `getSession()`.
   An unconfigured Supabase client yields `null` (anonymous), which is the
   fail-closed posture for fresh clones and CI; production builds gate on
   `check-env`.
4. Every Server Action and protected page calls `requireUser()` /
   `requireOrgRole()`; RLS is the final enforcement layer. Proxy matching
   never protects anything by itself (Server Functions bypass it).

## Flows

| Route | Purpose |
|---|---|
| `/signup` | Email + password; confirmation emails ON (production parity). Already-registered emails are routed to sign in (journey J1). |
| `/auth/callback` | PKCE code exchange for verification/recovery links; `next` restricted to same-origin paths; one generic failure surface. |
| `/login` | Password sign-in; authed visitors are bounced to `/onboarding`. `?error=` banners are generic by design. |
| `/onboarding` | Workspace router: members land in their oldest workspace; verified users without one create it atomically; `?new=1` skips the router. |
| `/forgot-password`, `/reset-password` | Recovery link → same callback → `updateUser`. Neutral copy everywhere (no account enumeration). |
| `/invite/[token]` | Invitation landing: preview (org/inviter/role) requires the signed-in email to match the invite. |

## Actions and errors

All auth mutations are Server Actions in `src/features/auth/actions.ts`.
Inputs are Zod-validated; provider errors map to stable user-facing copy
(rate limits, generic failure, already-registered). Provider text, emails,
tokens, and redirect URLs never appear in UI or logs.

## Testing notes (D016/D020)

There is no local Supabase stack. Tests provision confirmed users through the
service-role admin API (server-side only) and mint links via `generateLink`;
the built-in email service is rate-limited enough that `signUp` itself 429s,
so automated flows never depend on it. The full authenticated E2E journey
opts in with `E2E_AUTH_JOURNEY=1` and requires the hosted project's redirect
allowlist to cover the test origin's `/auth/callback`. CI keeps this journey
disabled unless the owner sets `RUN_HOSTED_E2E=true` and provides the
short-lived `ALLOW_HOSTED_TEST_MUTATIONS=true` acknowledgement.
