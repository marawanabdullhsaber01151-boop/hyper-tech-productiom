/** @format */
// Same lightweight, dependency-free pattern used throughout this project:
// guards against a specific regression in the wiring, not a substitute for
// the real integration/E2E checklist in the delivery report, which needs a
// running server and a real database.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const authRoute = readFileSync(resolve(process.cwd(), "src/routes/auth.ts"), "utf8");
const authMiddleware = readFileSync(resolve(process.cwd(), "src/middleware/auth.ts"), "utf8");

describe("security hardening — login route wiring", () => {
  it("the login route still checks account lockout before the password compare", () => {
    const lockedCheckIndex = authRoute.indexOf("isAccountLocked(user.lockedUntil)");
    const passwordCompareIndex = authRoute.indexOf("bcrypt.compare(password, user.passwordHash)");
    expect(lockedCheckIndex).toBeGreaterThan(-1);
    expect(passwordCompareIndex).toBeGreaterThan(-1);
    expect(passwordCompareIndex).toBeGreaterThan(lockedCheckIndex);
  });

  it("a failed password check still persists the lockout state to the database", () => {
    const failIndex = authRoute.indexOf("recordFailedLogin(user.failedLoginAttempts)");
    const updateIndex = authRoute.indexOf(
      "failedLoginAttempts: lockoutState.failedLoginAttempts",
    );
    expect(failIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(failIndex);
  });

  it("both /auth/login and /auth/login/verify-totp stay behind loginRateLimiter", () => {
    expect(authRoute).toMatch(/router\.post\("\/auth\/login",\s*loginRateLimiter/);
    expect(authRoute).toMatch(/router\.post\("\/auth\/login\/verify-totp",\s*loginRateLimiter/);
  });

  it("a TOTP-enabled account never gets a real session from /auth/login directly", () => {
    // The requiresTotp branch must return before completeLogin(...) is
    // reachable in the same handler body.
    const loginHandlerIndex = authRoute.indexOf('router.post("/auth/login",');
    const nextRouteIndex = authRoute.indexOf("router.post(", loginHandlerIndex + 40);
    const handlerBody = authRoute.slice(loginHandlerIndex, nextRouteIndex);
    const requiresTotpIndex = handlerBody.indexOf("requiresTotp: true");
    const completeLoginIndex = handlerBody.indexOf("await completeLogin(user, deviceInfo, ipAddress)");
    expect(requiresTotpIndex).toBeGreaterThan(-1);
    expect(completeLoginIndex).toBeGreaterThan(requiresTotpIndex);
  });

  it("disabling 2FA and regenerating backup codes both require re-entering the password, not just requireAuth", () => {
    const disableIndex = authRoute.indexOf('"/auth/2fa/disable"');
    const regenIndex = authRoute.indexOf('"/auth/2fa/regenerate-backup-codes"');
    expect(disableIndex).toBeGreaterThan(-1);
    expect(regenIndex).toBeGreaterThan(-1);
    expect(authRoute.slice(disableIndex, disableIndex + 500)).toContain("bcrypt.compare(password, user.passwordHash)");
    expect(authRoute.slice(regenIndex, regenIndex + 500)).toContain("bcrypt.compare(password, user.passwordHash)");
  });

  it("backup codes are only ever returned once, right after confirm/regenerate, never re-readable elsewhere", () => {
    // Guards against someone later adding a GET endpoint that reads
    // totpBackupCodes back out in plaintext — it is only ever written
    // (hashed) or compared against, never selected out.
    expect(authRoute).not.toMatch(/totpBackupCodes:\s*systemUsersTable\.totpBackupCodes/);
  });
});

describe("security hardening — MFA pre-auth token stays distinguishable from a real session token", () => {
  it("generateMfaPreAuthToken uses a short expiry and a distinct claim shape from generateToken", () => {
    const mfaFnIndex = authMiddleware.indexOf("export function generateMfaPreAuthToken");
    expect(mfaFnIndex).toBeGreaterThan(-1);
    const mfaFnBody = authMiddleware.slice(mfaFnIndex, mfaFnIndex + 400);
    expect(mfaFnBody).toContain('purpose: "mfa_pending"');
    expect(mfaFnBody).toContain('"5m"');
  });

  it("verifyMfaPreAuthToken rejects a token whose purpose claim does not match", () => {
    const verifyFnIndex = authMiddleware.indexOf("export function verifyMfaPreAuthToken");
    expect(verifyFnIndex).toBeGreaterThan(-1);
    const verifyFnBody = authMiddleware.slice(verifyFnIndex, verifyFnIndex + 400);
    expect(verifyFnBody).toContain('payload.purpose !== "mfa_pending"');
  });
});
