-- Security hardening: per-account brute-force lockout (independent of the
-- existing IP-based rate limiter) + optional TOTP two-factor authentication
-- (RFC 6238), implemented with Node's built-in crypto only — no new
-- dependency to install.

ALTER TABLE system_users
  ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS totp_secret text,
  ADD COLUMN IF NOT EXISTS totp_pending_secret text,
  ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS totp_backup_codes jsonb;

CREATE INDEX IF NOT EXISTS system_users_locked_until_idx
  ON system_users(locked_until)
  WHERE locked_until IS NOT NULL;
