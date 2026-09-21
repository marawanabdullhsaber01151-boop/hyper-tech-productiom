/** @format */
import { describe, expect, it } from "vitest";
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateBackupCodes,
  isAccountLocked,
  recordFailedLogin,
  clearLockoutState,
  lockoutRemainingSeconds,
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOCKOUT_MINUTES,
} from "./auth-security";

describe("base32Encode/base32Decode", () => {
  it("round-trips arbitrary buffers", () => {
    for (let len = 1; len <= 32; len++) {
      const buf = Buffer.from(Array.from({ length: len }, (_, i) => (i * 7 + len) % 256));
      expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    }
  });

  it("matches the well-known RFC 4648 style encoding for the RFC 6238 test key", () => {
    const secret = Buffer.from("12345678901234567890", "ascii");
    expect(base32Encode(secret)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });
});

describe("TOTP (RFC 6238) — verified against the official Appendix B test vectors", () => {
  // secret = ASCII "12345678901234567890", SHA1, 8 digits, 30s step
  const secret = base32Encode(Buffer.from("12345678901234567890", "ascii"));
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ];

  it.each(vectors)("time=%d -> %s", (timeSeconds, expected) => {
    expect(generateTotpCode(secret, timeSeconds * 1000, 30, 8)).toBe(expected);
  });

  it("verifyTotpCode accepts the exact current code", () => {
    const now = 1234567890 * 1000;
    expect(verifyTotpCode(secret, "89005924", now, 30, 8)).toBe(true);
  });

  it("verifyTotpCode rejects a wrong code even at the same instant", () => {
    const now = 1234567890 * 1000;
    expect(verifyTotpCode(secret, "00000000", now, 30, 8)).toBe(false);
  });

  it("verifyTotpCode tolerates one step of clock drift in either direction", () => {
    const now = 1234567890 * 1000;
    const codeOneStepEarlier = generateTotpCode(secret, now - 30_000, 30, 8);
    const codeOneStepLater = generateTotpCode(secret, now + 30_000, 30, 8);
    expect(verifyTotpCode(secret, codeOneStepEarlier, now, 30, 8, 1)).toBe(true);
    expect(verifyTotpCode(secret, codeOneStepLater, now, 30, 8, 1)).toBe(true);
  });

  it("verifyTotpCode rejects a code two steps away when window is 1", () => {
    const now = 1234567890 * 1000;
    const codeTwoStepsAway = generateTotpCode(secret, now - 60_000, 30, 8);
    expect(verifyTotpCode(secret, codeTwoStepsAway, now, 30, 8, 1)).toBe(false);
  });

  it("verifyTotpCode rejects malformed input (wrong length, non-digits)", () => {
    const now = 1234567890 * 1000;
    expect(verifyTotpCode(secret, "123", now, 30, 8)).toBe(false);
    expect(verifyTotpCode(secret, "abcdefgh", now, 30, 8)).toBe(false);
  });

  it("a freshly generated random secret produces a code that verifies against itself", () => {
    const fresh = generateTotpSecret();
    const now = Date.now();
    const code = generateTotpCode(fresh, now);
    expect(code).toHaveLength(6);
    expect(verifyTotpCode(fresh, code, now)).toBe(true);
  });
});

describe("generateBackupCodes", () => {
  it("generates the requested count, each in XXXX-XXXX shape, all unique", () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(new Set(codes).size).toBe(10);
  });

  it("never includes ambiguous characters (0/O/1/I)", () => {
    const codes = generateBackupCodes(50);
    for (const code of codes) expect(code).not.toMatch(/[01OI]/);
  });
});

describe("account lockout policy", () => {
  it("is not locked with no lockedUntil", () => {
    expect(isAccountLocked(null)).toBe(false);
  });

  it("is locked while lockedUntil is in the future", () => {
    const future = new Date(Date.now() + 60_000);
    expect(isAccountLocked(future)).toBe(true);
  });

  it("is not locked once lockedUntil has passed", () => {
    const past = new Date(Date.now() - 1000);
    expect(isAccountLocked(past)).toBe(false);
  });

  it(`locks the account only on reaching ${MAX_FAILED_LOGIN_ATTEMPTS} failed attempts`, () => {
    const now = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS - 1; i++) {
      const state = recordFailedLogin(i, now);
      expect(state.lockedUntil).toBeNull();
    }
    const finalState = recordFailedLogin(MAX_FAILED_LOGIN_ATTEMPTS - 1, now);
    expect(finalState.failedLoginAttempts).toBe(MAX_FAILED_LOGIN_ATTEMPTS);
    expect(finalState.lockedUntil).not.toBeNull();
    expect(finalState.lockedUntil!.getTime()).toBe(
      now.getTime() + LOCKOUT_MINUTES * 60 * 1000,
    );
  });

  it("clearLockoutState always resets to zero/null regardless of prior state", () => {
    expect(clearLockoutState()).toEqual({ failedLoginAttempts: 0, lockedUntil: null });
  });

  it("lockoutRemainingSeconds is 0 when not locked, positive when locked", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(lockoutRemainingSeconds(null, now)).toBe(0);
    const lockedUntil = new Date(now.getTime() + 90_000);
    expect(lockoutRemainingSeconds(lockedUntil, now)).toBe(90);
  });
});
