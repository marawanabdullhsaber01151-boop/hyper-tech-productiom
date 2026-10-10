-- Plan 03: activation / recovery / delivery channels. Expand-only, idempotent.
CREATE TABLE IF NOT EXISTS "portal_auth_tokens" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "purpose" text NOT NULL,
  "token_hash" text NOT NULL,
  "code_hash" text,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "uses" integer NOT NULL DEFAULT 0,
  "max_uses" integer NOT NULL DEFAULT 1,
  "attempts" integer NOT NULL DEFAULT 0,
  "created_by_staff_id" integer,
  "created_by_member_id" integer,
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_auth_tokens_hash_unique" ON "portal_auth_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_auth_tokens_user_purpose_idx" ON "portal_auth_tokens" ("user_id", "purpose", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_channels" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "address" text NOT NULL,
  "verified_at" timestamptz,
  "is_primary" boolean NOT NULL DEFAULT false,
  "enabled" boolean NOT NULL DEFAULT true,
  "prefs" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_channels_user_type_addr_unique" ON "portal_channels" ("user_id", "type", "address");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_channels_type_addr_idx" ON "portal_channels" ("type", "address");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_recovery_codes" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "used_at" timestamptz,
  "batch_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_recovery_codes_user_idx" ON "portal_recovery_codes" ("user_id", "used_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_outbox" (
  "id" bigserial PRIMARY KEY,
  "user_id" integer,
  "company_id" integer,
  "purpose" text NOT NULL,
  "channel" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "provider" text,
  "error_code" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "template_key" text,
  "masked_destination" text,
  "created_by_staff_id" integer,
  "created_by_member_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "sent_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_outbox_company_idx" ON "portal_outbox" ("company_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_outbox_user_idx" ON "portal_outbox" ("user_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_telegram_links" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_telegram_links_hash_unique" ON "portal_telegram_links" ("token_hash");
