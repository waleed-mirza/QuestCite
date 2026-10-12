import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";

/**
 * Prospect-facing request context (plan §W7/§15 IP hygiene): anonymous
 * visitors are tracked by a SALTED SHA-256 of their IP plus a coarse
 * user-agent summary — never the raw IP or the full UA string. The same salt
 * as audit hashing (AUDIT_HASH_SALT) is used; production boots only with it
 * set (check-env), so the dev fallback never runs there.
 */

const DEV_SALT = "questcite-dev-only-salt";
const HASH_SALT = process.env.AUDIT_HASH_SALT ?? DEV_SALT;

export type ProspectRequestContext = {
  ipHash: string | null;
  uaSummary: string | null;
};

function hashIp(ip: string): string {
  return createHash("sha256").update(`${HASH_SALT}:${ip}`).digest("hex");
}

/** First-hop client IP from the standard proxy headers, before any hashing. */
function extractIp(requestHeaders: Headers): string | null {
  const forwarded = requestHeaders.get("x-forwarded-for");
  if (forwarded !== null && forwarded.trim() !== "") {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") {
      return first;
    }
  }
  const realIp = requestHeaders.get("x-real-ip");
  if (realIp !== null && realIp.trim() !== "") {
    return realIp.trim();
  }
  return null;
}

/**
 * Coarse UA bucket ("Chrome on Windows"). Deliberately loses versions,
 * device models, and full UA entropy — enough for abuse review, never a
 * fingerprint.
 */
export function summarizeUserAgent(userAgent: string | null): string | null {
  if (userAgent === null || userAgent.trim() === "") {
    return null;
  }
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\/|Opera/.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Other";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad/.test(userAgent)
        ? "iOS"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "Other";
  return `${browser} on ${os}`.slice(0, 120);
}

/** Context for a server action (reads the ambient request headers). */
export async function prospectContextFromAction(): Promise<ProspectRequestContext> {
  return prospectContextFromHeaders(await headers());
}

/** Context for a route handler that already holds its Request headers. */
export function prospectContextFromHeaders(requestHeaders: Headers): ProspectRequestContext {
  const ip = extractIp(requestHeaders);
  return {
    ipHash: ip === null ? null : hashIp(ip),
    uaSummary: summarizeUserAgent(requestHeaders.get("user-agent")),
  };
}
