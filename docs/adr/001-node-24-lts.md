# ADR-001: Target Node.js 24 LTS (superseding the plan's Node 22 pin)

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** Owner (W1 kickoff)
- **Supersedes:** `trustops-10-week-production-plan.md` §6 (Node.js 22 LTS)

## Context

The plan pins Node.js 22 LTS in `engines` + `.nvmrc` with the note "re-evaluate only before v1.0." At Week 1 scaffold time (2026-08-31) the development machine already runs Node v24.19.0, and Node 24 is the current active LTS line (22 remains in maintenance LTS only). Node 22 hits end-of-maintenance in April 2027 — before this product's realistic sales horizon.

Choosing 22 would have forced every contributor and CI runner onto a version manager just to satisfy the pin, for no runtime benefit.

## Decision

Target **Node.js 24 LTS**:

- `engines.node`: `>=24.0.0 <25.0.0` (major-version window, patch/minor free)
- `.nvmrc`: `24`
- CI (`.github/workflows`) runs on `node: 24`

## Consequences

- Dev machine runs native — no version manager needed.
- Supabase, Vercel, and all W1-chosen dependencies must support Node 24 (verified at selection time; Next.js 16.3.3 requires ≥20.9, so supported).
- A revisit is required only if a critical dependency lags on Node 24 support.
- The plan document itself remains unchanged (historical artifact); this ADR is the authoritative record (decision D007).
