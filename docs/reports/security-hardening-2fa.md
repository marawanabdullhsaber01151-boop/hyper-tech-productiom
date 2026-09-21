# Security Hardening — Account Lockout + TOTP Two-Factor Authentication

## What was already there (read before assuming this was a weak starting point)

Before writing any code, the existing authentication stack was reviewed in
full (`src/routes/auth.ts`, `src/middleware/auth.ts`,
`src/middleware/rateLimiter.ts`, `src/main.ts`). It was already
meaningfully stronger than a typical first pass:

- bcrypt password hashing (cost 12), a generic "username or password
  incorrect" message that never reveals whether the username exists.
- IP-based rate limiting on `/auth/login` (10 attempts / 15 min).
- **Database-checked sessions, not stateless JWT trust**: the JWT carries
  only a session ID; every request re-reads the session, the user's role,
  and account status from PostgreSQL, so disabling a user or revoking a
  session takes effect on the very next request instead of waiting out a
  7-day token lifetime.
- A full session-management UI already existed: list active sessions
  per device, revoke any session remotely, automatic eviction of the
  oldest session when `maxConcurrentSessions` is exceeded, and a
  "new device" flag on login.
- A permission/delegation system (`requirePermission`, time-bounded
  delegations, per-user permission overrides) with a hash-chained,
  tamper-evident audit log (`writeAuditEvent` — each row's hash covers the
  previous row's hash, so a deleted or edited row breaks the chain
  detectably).
- `helmet` with a real, restrictive Content-Security-Policy (not the
  library defaults left untouched), `cors` with credentials and an
  explicit origin allowlist.
- A completely separate "vault password" for destructive operations
  (bulk data deletion), independent of the login password.

This delivery's job was therefore to close two specific, real gaps in
that already-solid foundation, not to build authentication from scratch.

## Gap 1: no account-level brute-force lockout

The existing rate limiter is IP-based only. It stops one IP hammering the
login endpoint, but it does **not** accumulate any count against the
*account* itself — a targeted attack against one specific username from a
botnet or rotating proxy (many IPs, each under the per-IP limit) was not
stopped by anything before this delivery.

**What this delivery adds**: a failed-attempt counter and lock timestamp
on `system_users` itself (`failed_login_attempts`, `locked_until`),
independent of source IP. After 5 consecutive failed password attempts,
the account locks for 15 minutes regardless of which IP the attempts came
from. A successful password check resets the counter. Every failed
attempt, every lock, and every login blocked by an existing lock is
written to the tamper-evident audit log with the actor, IP, and
user-agent — which did not happen for failed logins at all before this
delivery (only successful logins and session events were audited).

**Trade-off made explicitly, not left implicit**: returning a distinct
`423 Locked` status (rather than the same generic `401`) for a locked
account does let an attacker infer the account exists, once locked. This
is the same trade-off major platforms (GitHub, Google) make in practice —
the alternative (silently rejecting a locked account's correct password
with the generic message) would leave the legitimate user with no
explanation for why their correct password stopped working, at the cost
of a small amount of account-enumeration information to an attacker who
has already sent 5+ failed attempts against that specific username.

## Gap 2: no second factor

**What this delivery adds**: optional (per-user, self-service) TOTP
two-factor authentication — the standard algorithm used by Google
Authenticator, Authy, Microsoft Authenticator, and every major platform's
"authenticator app" option (RFC 6238, built on RFC 4226 HOTP).

Implemented using **Node's built-in `crypto` module only — no new
dependency was added to package.json.** `src/domain/auth-security.ts`
implements base32 encode/decode (needed for the standard `otpauth://`
secret format) and the HOTP/TOTP algorithm itself in about 60 lines, with
no external TOTP library.

**This was not just reviewed — it was executed and verified** against the
official RFC 6238 Appendix B test vectors (SHA1, 8 digits, the RFC's own
test key) before being relied on anywhere:

```
time=59          -> 94287082   ✓
time=1111111109  -> 07081804   ✓
time=1111111111  -> 14050471   ✓
time=1234567890  -> 89005924   ✓
time=2000000000  -> 69279037   ✓
```

All five matched exactly, run directly in this environment's Node.js
(which has built-in TypeScript support, so the actual `.ts` source file
was executed, not a hand-transcribed copy). The base32 implementation was
separately fuzz-tested (200 random buffers, encode→decode round-trip) and
matched a known reference encoding. Every assertion in
`src/domain/auth-security.test.ts` — including the clock-drift tolerance
window, malformed-input rejection, the lockout state machine, and the
backup-code shape/uniqueness — was also executed directly against the
real file and confirmed passing before this report was written, the same
way `src/routes/auth.security.test.ts`'s source-assertions were.

### The flow

1. `POST /auth/login` with username+password. If the account has 2FA
   enabled, a **real session is not created yet**. Instead the response is
   `{ requiresTotp: true, preAuthToken }` — `preAuthToken` is a separate,
   short-lived (5 minute) JWT with a distinct claim shape
   (`{ mfaUserId, purpose: "mfa_pending" }`, no `sessionId`) signed with
   the same secret. It is structurally impossible for this token to be
   accepted by `requireAuth` (which only ever looks up `payload.sessionId`
   in `login_sessions`) even if someone tried to reuse it there.
2. `POST /auth/login/verify-totp` with `{ preAuthToken, code }`. `code` can
   be the 6-digit authenticator code, or one of the one-time backup codes
   issued at setup. Only on success is a real session created — via the
   exact same `completeLogin()` function the plain-password path uses (concurrent-session
   eviction, new-device detection, the session row, the real token), so
   the two paths cannot drift apart on what "a logged-in session" means.
   This endpoint sits behind the same `loginRateLimiter` as `/auth/login`
   (same IP bucket, so a combined ceiling applies) so the 6-digit code
   cannot be brute-forced either.
3. Self-service management, all behind normal `requireAuth`:
   `GET /auth/2fa/status`, `POST /auth/2fa/setup` (generates a *pending*
   secret — nothing is activated by generating it), `POST /auth/2fa/confirm`
   (requires typing a real code from the authenticator app before the
   secret goes live — an abandoned setup never half-activates 2FA),
   `POST /auth/2fa/disable` and `POST /auth/2fa/regenerate-backup-codes`
   (both require re-entering the current password, not just having a
   valid session token — so a stolen/hijacked token alone cannot turn off
   the extra protection layer it is itself weaker than).
4. Ten one-time backup codes (format `XXXX-XXXX`, drawn from an
   unambiguous alphabet with no `0/O/1/I`) are generated and shown exactly
   once at confirm time. Only their bcrypt hashes are ever stored — same
   treatment as the login password itself. A used backup code is removed
   from the list (true one-time use).

### Performance choices, since this delivery was asked to keep them in mind

- **Backup-code hashing uses bcrypt cost 8, not the cost-12 used for login
  passwords.** A wrong code that also fails the TOTP check has to be
  compared against up to 10 stored backup-code hashes in the worst case
  (bcrypt gives no way to reverse a hash to check equality faster). At
  cost 12 that is roughly a full extra second added to a login attempt in
  the worst case; at cost 8 it drops to a small fraction of that. This is
  a deliberate, justified reduction: backup codes are high-entropy
  (~40 bits) machine-generated strings, not human-chosen passwords, so a
  lower bcrypt cost does not meaningfully weaken them against offline
  brute force the way it would for a password.
- `verifyTotpCode` does at most 3 HMAC-SHA1 computations (current window
  ± 1 for clock drift) — microseconds, not a measurable cost.
- A partial index (`WHERE locked_until IS NOT NULL`) was added on
  `system_users.locked_until` for a future "list currently locked
  accounts" admin view; the login path itself doesn't need it (it already
  reads the full user row by the existing unique `username` index).
- The lockout-state database write on a successful login is skipped
  entirely when there was nothing to clear (`failedLoginAttempts === 0 &&
  !lockedUntil`) — the overwhelming common case (a user who typed their
  password right) pays zero extra writes compared to before this
  delivery.

## What this delivery does not add

- **No QR code image for 2FA setup.** The secret is shown as copyable
  text with an `otpauth://` URI constructed alongside it, for manual entry
  into an authenticator app — every major authenticator app supports this
  (it is literally what "can't scan? enter code manually" does in all of
  them). Generating a scannable QR code client-side would need either a
  new dependency or a hand-written QR encoder (Reed-Solomon error
  correction is non-trivial to get right and, unlike the TOTP algorithm
  above, could not be verified against official test vectors the same
  way in the time available); an external QR-image API would violate the
  existing CSP (`imgSrc` is `'self' data: blob:` only, correctly) and
  depend on outbound internet access this system should not require for a
  security feature. Manual entry is fully functional, just one extra
  step.
- **No admin-side "require 2FA for this role" enforcement.** 2FA is
  currently opt-in per user. A future delivery could add a setting
  (e.g. "chairman and executive_manager must have 2FA enabled") that
  blocks login or forces setup for those roles — not built here.
- **No admin ability to see or remotely disable another user's 2FA**
  (e.g., for a lost-phone recovery where the user also lost their backup
  codes). Today the only path back in for that scenario is a
  database-level fix. Worth adding as a `chairman`-only
  "disable 2FA for user X" endpoint with mandatory audit logging in a
  follow-up.
- **No WebAuthn/passkey support.** TOTP was chosen because it needed no
  new dependency and is universally supported by existing free
  authenticator apps; WebAuthn is a meaningfully larger feature (needs a
  browser API integration, a new dependency for server-side verification,
  and its own schema) and was out of scope here.
- **JWT session lifetime (7 days) and the absence of refresh-token
  rotation were reviewed and deliberately left unchanged.** Redesigning
  that is a materially larger, cross-cutting change to every authenticated
  request in the system and was not attempted alongside this delivery.

## Exact change manifest

### Added

```text
migrations/0065_security_hardening_2fa.sql
src/domain/auth-security.ts
src/domain/auth-security.test.ts
src/routes/auth.security.test.ts
docs/reports/security-hardening-2fa.md
CHANGE-MANIFEST-SECURITY-HARDENING.md
```

### Modified

```text
src/db/schema/settings.ts   (new columns on system_users: lockout + TOTP; jsonb import added)
src/middleware/auth.ts      (generateMfaPreAuthToken / verifyMfaPreAuthToken)
src/routes/auth.ts          (lockout on /auth/login; new /auth/login/verify-totp; new /auth/2fa/* management endpoints)
public/login.html           (second-step TOTP form)
public/JS/auth.js           (handles requiresTotp response, drives the second step)
public/settings.html        (2FA card in "حسابي الشخصي")
public/JS/settings.js       (2FA setup/confirm/disable/regenerate flow)
```

### Deleted

```text
None
```

## Migration

`migrations/0065_security_hardening_2fa.sql`. Additive only — new
nullable/defaulted columns (`failed_login_attempts integer NOT NULL
DEFAULT 0`, `totp_enabled boolean NOT NULL DEFAULT false`, the rest
nullable) and one partial index. Every existing user account is
unaffected until they opt into 2FA; nobody's login behavior changes from
this migration alone.

## Environment limitation for this delivery, and what changed about how it
was handled

Same sandbox as every delivery in this conversation: no outbound network,
no `node_modules`, no reachable PostgreSQL. `npm ci`, `npm test`,
`npm run build`, and any real database call were **not** executed.

What *was* done, going further than previous deliveries in this
conversation because the stakes of getting authentication crypto wrong are
higher than a UI or a validation rule:

- The actual HOTP/TOTP/base32 implementation was executed directly (this
  container's Node.js has built-in TypeScript support) against the
  official RFC 6238 test vectors and a 200-iteration base32 round-trip
  fuzz test, both shown passing above, before a single route was written
  against it.
- Every assertion in both new test files
  (`src/domain/auth-security.test.ts`,
  `src/routes/auth.security.test.ts`) was independently executed against
  the real files and confirmed passing, not just written and assumed
  correct.
- `node --check` (syntax-level, not full type-checking — see the Phase 03
  delivery 3 report for the exact distinction) passed on every `.ts` and
  `.js` file touched.
- Every new export was cross-checked with `grep` against the file that
  defines it before being imported elsewhere.

What this environment still cannot verify, and remains deployment-gate
evidence:

- The actual login → lockout → unlock-after-15-minutes cycle against a
  real database and a real clock.
- The actual browser flow: password → TOTP prompt → authenticator app →
  session created; QR-less manual secret entry actually working in Google
  Authenticator/Authy end to end.
- `npx tsc --noEmit` (fails immediately here on `Cannot find module`
  errors for every file in the project due to no `node_modules`, not
  specific to this delivery).

## Required before this delivery is accepted into the target environment

Run `npm ci`, `npx tsc --noEmit`, `npm test`, `npm run build`, then
`npm run db:migrate` against a real staging database. Then:

1. 5 wrong passwords in a row for one account → `423` on the 5th, account
   locked; 6th attempt (even with the *correct* password) → still `423`
   with a remaining-time message. Wait out the 15 minutes (or update
   `locked_until` directly in staging) → correct password now succeeds
   and `failed_login_attempts` resets to 0.
2. Confirm every failed attempt, the lock event, and the eventual success
   produced a row in `audit_events` with the right `action_key` and that
   the hash chain (`prev_hash`/`record_hash`) is unbroken across them.
3. Enable 2FA end to end for a test user: `/auth/2fa/setup` → add the
   secret to an actual authenticator app (Google Authenticator or
   equivalent) → `/auth/2fa/confirm` with the real 6-digit code → confirm
   `totp_enabled` is now true and 10 backup codes were shown exactly once.
4. Log out, log back in with that user: confirm `/auth/login` returns
   `requiresTotp: true` and no `login_sessions` row was created for that
   attempt; confirm a *wrong* 6-digit code is rejected; confirm the
   *correct* current code completes login and creates the session.
5. Use one backup code to log in instead of the TOTP code → confirm it
   works once, and confirm reusing the same backup code afterward fails
   and the code count dropped by exactly one.
6. `/auth/2fa/disable` with the wrong password → rejected; with the
   correct password → 2FA off, next login needs only the password again.
7. Browser check on `login.html`/`settings.html`: the two-step form
   actually renders and transitions correctly; the settings 2FA card
   shows the right state and buttons in both the "enabled" and "disabled"
   states; "نسخ" actually copies the secret.

## Recovery

Migration `0065` is additive; nothing existing is dropped or altered
destructively. To revert the behavior change, restore the previous
versions of the seven modified files listed above; the new columns can be
left in place unused (every account's `totp_enabled` defaults to `false`,
so reverting the code alone fully restores the previous login flow for
every account, 2FA-enabled or not, without any data cleanup needed first).

## Known risks and next-phase dependencies

- The account-enumeration trade-off from the `423` status code, explained
  above under Gap 1 — accepted deliberately, not an oversight.
- Lost-phone-and-lost-backup-codes recovery currently requires a
  database-level fix; an admin-facing "force disable 2FA for user X (with
  mandatory audit reason)" endpoint would close this and is a natural,
  bounded next delivery.
- No admin-mandated 2FA-by-role yet — still fully opt-in per user.
- Real database execution, the full checklist above, and browser evidence
  remain deployment-gate evidence, not local-test evidence, consistent
  with every report in this series.
