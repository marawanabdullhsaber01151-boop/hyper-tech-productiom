-- 0093 — تفضيلات المستخدم المحفوظة على السيرفر (ترتيب وإخفاء كروت اللوحة) — الخطوة 41ب
--
-- جدول عام: صف لكل (مستخدم، مفتاح) وقيمته JSON. التفضيل بيمشي مع المستخدم على أي جهاز.
-- مفيش بيانات حسّاسة هنا، والمفاتيح المسموحة بتتحدد في الكود.
--
-- Rollback:
--   DROP TABLE IF EXISTS user_preferences;

CREATE TABLE IF NOT EXISTS "user_preferences" (
  "user_id" integer NOT NULL REFERENCES "system_users"("id") ON DELETE CASCADE,
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "key")
);
