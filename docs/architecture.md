# Architecture

QuestCite is a modular monolith using the Next.js App Router, Supabase
Postgres/Auth/Storage, and small feature modules. The design keeps tenant
authorization in Postgres and keeps provider secrets on the server.

## Request boundaries

```text
Browser
  ├─ public pages and safe Client Components
  ├─ authenticated pages through the request-scoped Supabase client
  └─ API routes / server actions with Zod input validation
       ├─ domain/service module
       ├─ Supabase RPC or RLS-protected table query
       └─ private storage/provider adapter (server only)
```

App Router pages are Server Components by default. Interactive forms and
browser state are Client Components. `server-only` marks protect environment,
service-role, provider, storage, and filesystem code from client bundles.

## Feature modules

- `src/features/auth` — signup, login, recovery, and session-safe redirects.
- `src/features/organizations` and `src/features/members` — tenancy and roles.
- `src/features/documents` and `src/features/knowledge` — evidence ingestion,
  immutable versions, chunks, and approved Q&A.
- `src/features/questionnaires` — workbook mapping, AI runs, review, versions,
  and export.
- `src/features/trust-center` — public branding, access requests, grants, and
  gated downloads.
- `src/features/billing` and `src/features/settings` — quotas, payments, and
  lifecycle controls.
- `src/features/demo` — fictional client-safe fixtures and read-only tour.

## Tenancy and RLS

Tenant tables carry `organization_id`, explicit grants, RLS policies, and
cross-tenant integration tests. Sensitive writes use SECURITY DEFINER RPCs
with stable error codes, locked `search_path`, and no browser-supplied tenant
authority. The service-role client is restricted to controlled server paths and
seed/verification tooling.

## Data safety

Document and questionnaire objects are private and addressed by server-built
paths. Public Trust Center reads use one allowlisted RPC plus application-side
Zod validation. Logs contain operational codes and counts only. See
[`data-flow.md`](data-flow.md) and [`database-and-rls.md`](database-and-rls.md).
