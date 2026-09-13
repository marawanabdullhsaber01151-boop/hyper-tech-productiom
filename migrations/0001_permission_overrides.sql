-- ============================================================
-- Migration: permission_overrides
-- الغرض: جدول الصلاحيات المخصّصة (استثناءات دقيقة لكل مستخدم،
-- دائمة أو مؤقتة بتاريخ انتهاء — بديل السيرفر لـ npm run db:push)
--
-- طريقة التشغيل: نفّذه مباشرة على قاعدة البيانات بأي أداة SQL
-- (psql, TablePlus, pgAdmin...):
--   psql "$DATABASE_URL" -f migrations/0001_permission_overrides.sql
--
-- آمن للتشغيل أكتر من مرة (IF NOT EXISTS) — لو الجدول اتعمل
-- بالفعل عن طريق db:push، تشغيل الملف ده تاني مش هيعمل أي حاجة.
-- ============================================================

CREATE TABLE IF NOT EXISTS "permission_overrides" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "system_users"("id") ON DELETE CASCADE,
  "action_key" TEXT NOT NULL,
  "allowed" BOOLEAN NOT NULL,
  "reason" TEXT,
  "expires_at" TIMESTAMP WITH TIME ZONE,
  "granted_by" INTEGER NOT NULL REFERENCES "system_users"("id"),
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "revoked_at" TIMESTAMP WITH TIME ZONE,
  "revoked_by" INTEGER REFERENCES "system_users"("id")
);

CREATE INDEX IF NOT EXISTS "permission_overrides_user_idx"
  ON "permission_overrides" ("user_id");

CREATE INDEX IF NOT EXISTS "permission_overrides_user_action_idx"
  ON "permission_overrides" ("user_id", "action_key");
