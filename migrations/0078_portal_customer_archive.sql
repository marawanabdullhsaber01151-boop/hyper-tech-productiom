-- 0078 — أرشفة شركات البوابة (بديل «الحذف» للشركة اللي قررت ما تتعاملش معانا)
--
-- الفكرة: الأرشفة علامة على نفس الصف (مش نقل لجدول تاني) فكل الطلبات والفواتير والشات والعلاقات
-- تفضل سليمة، والرجوع بضغطة واحدة. الشركة المؤرشفة = موقوفة + مخفية من القوايم العادية.
-- الأعمدة كلها اختيارية (NULL = مش مؤرشفة) فمفيش أثر على أي صف موجود.
--
-- Rollback:
--   DROP INDEX IF EXISTS portal_customers_archived_at_idx;
--   ALTER TABLE portal_customers DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by_user_id, DROP COLUMN IF EXISTS archive_reason;

ALTER TABLE "portal_customers"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "archived_by_user_id" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "archive_reason" text;

CREATE INDEX IF NOT EXISTS "portal_customers_archived_at_idx"
  ON "portal_customers" ("archived_at")
  WHERE "archived_at" IS NOT NULL;
