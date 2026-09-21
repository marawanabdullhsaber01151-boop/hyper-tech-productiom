# CHANGE MANIFEST — SECURITY HARDENING (Account Lockout + TOTP 2FA)

## Added

```text
migrations/0065_security_hardening_2fa.sql
src/domain/auth-security.ts
src/domain/auth-security.test.ts
src/routes/auth.security.test.ts
docs/reports/security-hardening-2fa.md
CHANGE-MANIFEST-SECURITY-HARDENING.md
```

## Modified

```text
src/db/schema/settings.ts
src/middleware/auth.ts
src/routes/auth.ts
public/login.html
public/JS/auth.js
public/settings.html
public/JS/settings.js
```

## Deleted

```text
None
```

## What this closes

Two real gaps found by reviewing the existing (already solid — DB-checked
sessions, hash-chained audit log, session management UI, helmet+CSP,
IP rate limiting) authentication stack before writing anything:

1. No account-level brute-force lockout (only IP-based rate limiting
   existed) — closed with a 5-attempt / 15-minute lockout independent of
   source IP, plus audit logging of every failed attempt (previously not
   audited at all).
2. No second factor — closed with optional, self-service TOTP 2FA
   (RFC 6238), implemented using Node's built-in `crypto` only (no new
   dependency), with backup codes for device loss.

See `docs/reports/security-hardening-2fa.md` for the full explanation,
including the TOTP/base32 implementation being executed and verified
against the official RFC 6238 test vectors before being relied on
anywhere, and everything this delivery deliberately does not cover (QR
code generation, admin-mandated 2FA, WebAuthn, JWT lifetime redesign).

## Migration

`migrations/0065_security_hardening_2fa.sql`. Additive only.

## Delivery method

Delta delivery. Copy over the existing project root; do not extract into a
nested directory.

```bash
npm ci
npx tsc --noEmit
npm test
npm run build
npm run db:migrate   # against a real staging database
```

Then the manual/staging acceptance checklist in
`docs/reports/security-hardening-2fa.md`.

## Verification executed in this delivery

Same sandbox limitation as every delivery in this conversation: no
outbound network, no `node_modules`, no reachable PostgreSQL — `npm ci`,
`npm test`, `npm run build`, and any real database call were **not**
executed. What *was* done, and is new to this delivery: the actual
HOTP/TOTP/base32 crypto implementation was executed directly against the
official RFC 6238 test vectors (all 5 passed) and a 200-iteration
round-trip fuzz test, and every assertion in both new test files was
independently executed against the real source files and confirmed
passing — not just written and assumed correct. See "Environment
limitation for this delivery" in the linked report for the full detail.
