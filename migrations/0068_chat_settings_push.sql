-- Chat runtime settings (manager-editable) + Web Push subscriptions. Idempotent.
CREATE TABLE IF NOT EXISTS "chat_settings" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_by_user_id" integer,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "chat_settings_singleton" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_push_subscriptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "audience" text NOT NULL,
  "portal_customer_id" integer REFERENCES "portal_customers"("id") ON DELETE CASCADE,
  "user_id" integer REFERENCES "system_users"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "chat_push_audience_check" CHECK (
    ("audience" = 'customer' AND "portal_customer_id" IS NOT NULL AND "user_id" IS NULL) OR
    ("audience" = 'staff' AND "user_id" IS NOT NULL AND "portal_customer_id" IS NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_push_endpoint_unique" ON "chat_push_subscriptions" ("endpoint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_push_customer_idx" ON "chat_push_subscriptions" ("portal_customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_push_user_idx" ON "chat_push_subscriptions" ("user_id");
