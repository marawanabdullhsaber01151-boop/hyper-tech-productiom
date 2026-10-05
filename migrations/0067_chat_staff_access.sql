-- Per-user chat access override (who may reply to customers). See
-- src/db/schema/portal-chat.ts. Idempotent.
CREATE TABLE IF NOT EXISTS "chat_staff_access" (
  "user_id" integer PRIMARY KEY NOT NULL REFERENCES "system_users"("id") ON DELETE CASCADE,
  "mode" text NOT NULL,
  "updated_by_user_id" integer,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "chat_staff_access_mode_check" CHECK ("mode" IN ('manager','agent','observer','none'))
);
