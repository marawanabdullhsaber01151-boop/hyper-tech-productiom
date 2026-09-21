/** @format */
/**
 * Security hardening — pure logic only (no database, no I/O), so all of it
 * is exhaustively unit-testable without a live server. Two independent
 * pieces:
 *
 *  1. TOTP two-factor authentication (RFC 6238, built on RFC 4226 HOTP),
 *     implemented with Node's built-in `crypto` module only — no new
 *     dependency to install. The HOTP/TOTP functions here were verified
 *     against the official RFC 6238 Appendix B test vectors before this
 *     file was written (SHA1, 8 digits, secret "12345678901234567890"):
 *     time=59 -> 94287082, time=1111111109 -> 07081804,
 *     time=1111111111 -> 14050471, time=1234567890 -> 89005924,
 *     time=2000000000 -> 69279037. All five matched exactly.
 *
 *  2. Account-level brute-force lockout — independent of and in addition
 *     to the existing IP-based rate limiter in
 *     src/middleware/rateLimiter.ts. The rate limiter stops one IP from
 *     hammering the login endpoint; this stops a *targeted* attack on one
 *     specific account from many different IPs (a botnet, a rotating
 *     proxy) that the IP limiter alone cannot see, because it never
 *     accumulates a count against the account itself.
 */
import { createHmac, randomBytes, randomInt } from "node:crypto";

// ── Base32 (RFC 4648) — TOTP secrets are conventionally shared with an
// authenticator app as base32 text (the otpauth:// URI format requires
// it), not raw bytes. ──
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder !== 0) {
    const last = bits.slice(bits.length - remainder).padEnd(5, "0");
    output += BASE32_ALPHABET[parseInt(last, 2)];
  }
  return output;
}

export function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue; // ignore spaces/formatting characters
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(byteLength = 20): string {
  // 20 bytes (160 bits) matches the RFC 6238 reference test-vector key
  // length and is the conventional default for SHA1-based TOTP.
  return base32Encode(randomBytes(byteLength));
}

function hotp(secret: Buffer, counter: number, digits: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = binCode % 10 ** digits;
  return code.toString().padStart(digits, "0");
}

export function generateTotpCode(
  base32Secret: string,
  forTimeMs: number = Date.now(),
  stepSeconds = 30,
  digits = 6,
): string {
  const counter = Math.floor(forTimeMs / 1000 / stepSeconds);
  return hotp(base32Decode(base32Secret), counter, digits);
}

/**
 * Verifies a 6-digit code the user typed against the secret, tolerating
 * clock drift by also accepting the immediately-previous and
 * immediately-next 30-second windows (±30s) — a fixed authenticator-app
 * clock a few seconds off a strict server clock is common and should not
 * lock a legitimate user out.
 */
export function verifyTotpCode(
  base32Secret: string,
  code: string,
  forTimeMs: number = Date.now(),
  stepSeconds = 30,
  digits = 6,
  windowSteps = 1,
): boolean {
  const normalized = code.trim();
  if (!/^\d+$/.test(normalized) || normalized.length !== digits) return false;
  const counter = Math.floor(forTimeMs / 1000 / stepSeconds);
  const secretBuffer = base32Decode(base32Secret);
  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    if (hotp(secretBuffer, counter + delta, digits) === normalized) return true;
  }
  return false;
}

/**
 * One-time backup/recovery codes, issued when 2FA is first enabled, for
 * the case the user loses their authenticator device. Format
 * "XXXX-XXXX" (unambiguous alphabet — no 0/O/1/I) for easy transcription.
 * Returned in plaintext exactly once by the route layer; only a bcrypt
 * hash of each is ever persisted (matches how passwords themselves are
 * stored in this codebase).
 */
const BACKUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let code = "";
    for (let j = 0; j < 8; j++) {
      if (j === 4) code += "-";
      code += BACKUP_CODE_ALPHABET[randomInt(BACKUP_CODE_ALPHABET.length)];
    }
    codes.push(code);
  }
  return codes;
}

// ── Account-level brute-force lockout ──
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export function isAccountLocked(
  lockedUntil: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return !!lockedUntil && lockedUntil.getTime() > now.getTime();
}

export type LockoutState = {
  failedLoginAttempts: number;
  lockedUntil: Date | null;
};

/** Called after a failed password check. */
export function recordFailedLogin(
  currentFailedAttempts: number,
  now: Date = new Date(),
): LockoutState {
  const failedLoginAttempts = currentFailedAttempts + 1;
  const lockedUntil =
    failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS
      ? new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000)
      : null;
  return { failedLoginAttempts, lockedUntil };
}

/** Called after a successful password check (2FA notwithstanding). */
export function clearLockoutState(): LockoutState {
  return { failedLoginAttempts: 0, lockedUntil: null };
}

export function lockoutRemainingSeconds(
  lockedUntil: Date | null | undefined,
  now: Date = new Date(),
): number {
  if (!isAccountLocked(lockedUntil, now)) return 0;
  return Math.ceil((lockedUntil!.getTime() - now.getTime()) / 1000);
}
