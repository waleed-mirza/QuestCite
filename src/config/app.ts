/**
 * Client-safe app configuration. Only NEXT_PUBLIC_ values live here — Next.js
 * inlines them at build time, so this module may be imported from anywhere.
 * Server-only settings belong in @/lib/env (guarded by `server-only`).
 */

export const appConfig = {
  name: process.env.NEXT_PUBLIC_APP_NAME || "QuestCite",
  url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
} as const;
