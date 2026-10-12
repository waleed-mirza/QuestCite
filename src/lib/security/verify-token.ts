import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless email-verification tokens for Trust Center access requests
 * (D029): `requestId.expiry.hmac`. No server-side storage — the HMAC (keyed
 * with AUDIT_HASH_SALT, same as IP hashing) binds the request id to a
 * 24-hour expiry; the app verifies the link and then calls the idempotent
 * confirm RPC. Anyone holding only the request id (a uuid) can mint nothing.
 */

const VERIFY_TTL_SECONDS = 24 * 60 * 60;

const DEV_SALT = "questcite-dev-only-salt";

/**
 * Read per call (not module load) so tests can exercise salt binding, and so
 * a rotated salt takes effect without a rebuild. Production always has the
 * env set (check-env).
 */
function hashSalt(): string {
  return process.env.AUDIT_HASH_SALT ?? DEV_SALT;
}

function signature(payload: string): string {
  return createHmac("sha256", hashSalt()).update(payload).digest("hex");
}

export function createAccessVerificationToken(requestId: string): string {
  const expiry = Math.floor(Date.now() / 1000) + VERIFY_TTL_SECONDS;
  const payload = `${requestId}.${expiry}`;
  return `${payload}.${signature(payload)}`;
}

export type VerifiedAccessRequest = { requestId: string };

export function verifyAccessVerificationToken(token: string): VerifiedAccessRequest | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [requestId, expiryText, signatureText] = parts;
  if (requestId === undefined || expiryText === undefined || signatureText === undefined) {
    return null;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)) {
    return null;
  }
  const expiry = Number(expiryText);
  if (!Number.isInteger(expiry) || expiry < Math.floor(Date.now() / 1000)) {
    return null;
  }
  const expected = signature(`${requestId}.${expiryText}`);
  if (signatureText.length !== expected.length) {
    return null;
  }
  const matches = timingSafeEqual(Buffer.from(signatureText, "utf8"), Buffer.from(expected, "utf8"));
  return matches ? { requestId } : null;
}
