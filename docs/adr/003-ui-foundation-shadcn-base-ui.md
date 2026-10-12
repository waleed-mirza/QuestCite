# ADR-003: UI foundation — shadcn/ui (2026 registry, Base UI primitives)

- **Status:** Accepted
- **Date:** 2026-09-01
- **Context:** plan §6 UI row (Tailwind + shadcn/ui + Radix + Lucide)

## Decision

Use the current shadcn/ui CLI with its 2026 defaults, which pairs **Base UI** (`@base-ui/react`, the Radix team's successor library) with cva + tailwind-merge + Lucide icons. Components are source-owned under `src/components/ui/` (never a black-box npm dependency).

## Context

The product is **MIT-licensed source that operators self-host** — UI must be readable, forkable, and free of per-seat licensing. shadcn's copy-in model is exactly that. The 2026 CLI moved from Radix to Base UI and dropped the `asChild` slot pattern.

## Consequences

- Component composition uses Base UI's `render={<Link href/>}` prop instead of `asChild` — see `src/app/(marketing)/layout.tsx`. Tests must query the rendered element's real role (e.g., "Sign out" is a `link`, not a `button`).
- The `shadcn` package sits in `dependencies` because `globals.css` imports `shadcn/tailwind.css` (build-time CSS dependency).
- Operators can restyle everything from the theme tokens in `src/app/globals.css` (Tailwind v4 `@theme`, no tailwind.config.js).

Rejected: hand-rolled component library (slower, worse a11y), MUI/AntD (runtime deps, hard to reskin), v3-era shadcn + Radix (superseded upstream).
