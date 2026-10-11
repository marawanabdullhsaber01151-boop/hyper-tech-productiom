-- Plan 05: إدارة عملاء البوابة — فهارس للقائمة + سجل تغييرات الإعدادات (expand-only).
CREATE INDEX IF NOT EXISTS "portal_customers_active_created_idx"
  ON "portal_customers" ("is_active", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "sales_orders_contact_created_idx"
  ON "sales_orders" ("contact_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "portal_members_last_active_idx"
  ON "portal_members" ("company_id", "last_active_at" DESC);

CREATE TABLE IF NOT EXISTS "portal_settings_history" (
  "id" bigserial PRIMARY KEY,
  "scope" text NOT NULL,
  "scope_id" integer,
  "key" text NOT NULL,
  "before_value" jsonb,
  "after_value" jsonb,
  "had_before" boolean NOT NULL DEFAULT false,
  "has_after" boolean NOT NULL DEFAULT true,
  "changed_by" text NOT NULL,
  "reverted_of" bigint,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "portal_settings_history_scope_check" CHECK ("scope" IN ('global','company','member'))
);
CREATE INDEX IF NOT EXISTS "portal_settings_history_scope_idx"
  ON "portal_settings_history" ("scope", "scope_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "portal_settings_history_key_idx"
  ON "portal_settings_history" ("key", "created_at" DESC);
