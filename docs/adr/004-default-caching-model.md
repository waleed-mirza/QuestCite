# ADR-004: Next.js 16 default caching model (Cache Components OFF)

- **Status:** Accepted
- **Date:** 2026-09-01

## Decision

Run Next.js 16.3.3 with the **default caching model** — `cacheComponents: true` stays OFF. `fetch` requests are not cached unless explicitly opted in per-request.

## Context

Cache Components (the `use cache` directive + `cacheLife`/`cacheTag` regime) is opt-in in 16.3. It removes the classic Route Segment Configs (`dynamic`, `revalidate`, …) and introduces `instant`/`connection` semantics designed around a largely-static PPR model.

QuestCite is a **multi-tenant RLS application**: nearly every dashboard view is user- and org-scoped, rendered from request-time auth claims. Cacheable surfaces (public Trust Center pages) are a small slice that the default model handles fine with explicit opt-ins. Adopting a new caching paradigm for a minority of routes adds protocol risk (stale cross-tenant content is a security-adjacent bug class here, plan §12).

## Consequences

- Route Segment Configs remain available where needed; `revalidateTag(tag, profile)` requires the two-arg form when used.
- Trust Center pages remain request-time by default; revisit caching only with measured production data and an explicit stale-data security review.
- No `experimental.ppr`/`dynamicIO`/`useCache` legacy flags anywhere.
