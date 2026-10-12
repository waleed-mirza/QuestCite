/**
 * Stateless verification-token tests (D029): HMAC binding, expiry, tamper
 * resistance, and format rejection. These tokens gate only the
 * submitted→pending_review flip, but they must still be unforgeable and
 * unrewindable.
 */

import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createAccessVerificationToken,
  verifyAccessVerificationToken,
} from "@/lib/security/verify-token";

const REAL_SALT = process.env.AUDIT_HASH_SALT;
const TEST_SALT = "unit-test-salt-0123456789abcdef0123456789";

describe("access verification tokens", () => {
  beforeEach(() => {
    process.env.AUDIT_HASH_SALT = TEST_SALT;
  });
  afterEach(() => {
    process.env.AUDIT_HASH_SALT = REAL_SALT;
  });

  it("round-trips a valid token to its request id", () => {
    const requestId = crypto.randomUUID();
    const token = createAccessVerificationToken(requestId);
    const verified = verifyAccessVerificationToken(token);
    expect(verified).not.toBeNull();
    expect(verified?.requestId).toBe(requestId);
  });

  it("rejects an expired token", () => {
    const requestId = crypto.randomUUID();
    // Mint a token whose expiry is already in the past: forge the payload and
    // sign it with the same (test) salt the verifier uses.
    const expiry = Math.floor(Date.now() / 1000) - 60;
    const signature = createHmac("sha256", TEST_SALT)
      .update(`${requestId}.${expiry}`)
      .digest("hex");
    expect(verifyAccessVerificationToken(`${requestId}.${expiry}.${signature}`)).toBeNull();
  });

  it("rejects a tampered signature (different request id, same signature)", () => {
    const token = createAccessVerificationToken(crypto.randomUUID());
    const parts = token.split(".");
    const forged = `${crypto.randomUUID()}.${parts[1] ?? ""}.${parts[2] ?? ""}`;
    expect(verifyAccessVerificationToken(forged)).toBeNull();
  });

  it("rejects garbage and wrong-shape tokens", () => {
    expect(verifyAccessVerificationToken("")).toBeNull();
    expect(verifyAccessVerificationToken("abc")).toBeNull();
    expect(verifyAccessVerificationToken("a.b.c.d")).toBeNull();
    expect(verifyAccessVerificationToken("not-a-uuid.99999999999.deadbeef")).toBeNull();
  });

  it("is salt-bound: a token minted under another salt is invalid", () => {
    const requestId = crypto.randomUUID();
    process.env.AUDIT_HASH_SALT = "other-salt-ffffffffffffffffffffffffffff";
    const token = createAccessVerificationToken(requestId);
    process.env.AUDIT_HASH_SALT = TEST_SALT;
    expect(verifyAccessVerificationToken(token)).toBeNull();
  });

  it("works without AUDIT_HASH_SALT set (dev fallback)", () => {
    delete process.env.AUDIT_HASH_SALT;
    const requestId = crypto.randomUUID();
    const token = createAccessVerificationToken(requestId);
    expect(verifyAccessVerificationToken(token)?.requestId).toBe(requestId);
  });
});
