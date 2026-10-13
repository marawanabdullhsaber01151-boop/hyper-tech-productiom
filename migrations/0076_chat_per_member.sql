-- Plan 08: محادثة لكل موظف (إضافة فقط). member_id فاضي = محادثة الشركة المشتركة.
ALTER TABLE "chat_conversations"
  ADD COLUMN IF NOT EXISTS "member_id" integer REFERENCES "portal_members"("id") ON DELETE SET NULL;

DROP INDEX IF EXISTS "chat_conversations_customer_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "chat_conversations_company_shared_unique"
  ON "chat_conversations" ("portal_customer_id") WHERE "member_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "chat_conversations_member_unique"
  ON "chat_conversations" ("portal_customer_id", "member_id") WHERE "member_id" IS NOT NULL;
