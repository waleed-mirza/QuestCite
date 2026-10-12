# ADR-002: Strictest practical TypeScript configuration

- **Status:** Accepted
- **Date:** 2026-09-01
- **Context:** plan §6 ("prevents vibe-coding errors"), AGENTS.md rule 5

## Decision

Beyond `strict: true` (create-next-app default), the project enables:

- `noUncheckedIndexedAccess` — indexed access returns `T | undefined`
- `exactOptionalPropertyTypes` — `undefined` is not assignable to optional properties unless explicitly in the type

## Context

This codebase is largely AI-generated under a quality protocol that forbids `any`, `@ts-ignore`, and unsafe casts. These two flags convert entire bug classes into compile errors:

- `arr[i].id` on a possibly-missing element (question rows, workbook cells, env lines)
- silently passing `undefined` where a property was merely *absent* (config objects, API payloads)

## Consequences

- More explicit code at boundaries (`?? defaults`, conditional spreads instead of `prop: maybeUndefined`); both patterns are already used in this repo (env schema, playwright config).
- Library types that assume looser semantics occasionally need small adapters — acceptable cost.
- Known friction: object destructure from arrays (`const [a = "", b = ""] = match`) — handled per-case.

Both flags stay on for the life of the product; removing either is an ADR-level decision.
