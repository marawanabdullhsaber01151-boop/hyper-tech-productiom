-- Phase 01: deployment ledger, health checks, idempotent commands, and
-- non-destructive data-audit findings.

ALTER TABLE "_migrations_applied"
  ADD COLUMN IF NOT EXISTS "checksum" text,
  ADD COLUMN IF NOT EXISTS "duration_ms" integer,
  ADD COLUMN IF NOT EXISTS "runner_version" text;

CREATE INDEX IF NOT EXISTS "_migrations_applied_applied_at_idx"
  ON "_migrations_applied" ("applied_at");

CREATE TABLE IF NOT EXISTS "system_health_checks" (
  "id" serial PRIMARY KEY,
  "check_key" text NOT NULL,
  "status" text NOT NULL,
  "summary" text NOT NULL,
  "details" jsonb,
  "checked_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "system_health_checks_key_unique"
  ON "system_health_checks" ("check_key");
CREATE INDEX IF NOT EXISTS "system_health_checks_status_idx"
  ON "system_health_checks" ("status");
CREATE INDEX IF NOT EXISTS "system_health_checks_checked_at_idx"
  ON "system_health_checks" ("checked_at");

CREATE TABLE IF NOT EXISTS "command_idempotency" (
  "id" serial PRIMARY KEY,
  "idempotency_key" text NOT NULL,
  "command_name" text NOT NULL,
  "request_hash" text NOT NULL,
  "correlation_id" text NOT NULL,
  "actor_user_id" integer,
  "status" text NOT NULL DEFAULT 'processing',
  "response_status" integer,
  "response_body" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "command_idempotency_key_unique"
  ON "command_idempotency" ("command_name", "idempotency_key");
CREATE INDEX IF NOT EXISTS "command_idempotency_actor_idx"
  ON "command_idempotency" ("actor_user_id", "created_at");

CREATE TABLE IF NOT EXISTS "data_audit_findings" (
  "id" serial PRIMARY KEY,
  "audit_run_id" text NOT NULL,
  "finding_type" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "severity" text NOT NULL DEFAULT 'warning',
  "title" text NOT NULL,
  "details" jsonb,
  "status" text NOT NULL DEFAULT 'open',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "data_audit_findings_run_idx"
  ON "data_audit_findings" ("audit_run_id");
CREATE INDEX IF NOT EXISTS "data_audit_findings_status_idx"
  ON "data_audit_findings" ("status", "severity");
CREATE INDEX IF NOT EXISTS "data_audit_findings_entity_idx"
  ON "data_audit_findings" ("entity_type", "entity_id");